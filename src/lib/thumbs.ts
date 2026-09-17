import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { getDb } from "@/lib/db";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import type { MediaRow } from "@/lib/api";

export interface ThumbState {
  status: "pending" | "ok" | "error";
  path?: string;
  color?: string; // dominant color "#RRGGBB"
  error?: string;
  /** permanent decode failure (bad content) — do not retry, render "no preview" */
  noPreview?: boolean;
}

interface ThumbResultRow {
  mediaId: number;
  thumbPath: string | null;
  dominantColor: string | null;
  ok: boolean;
  thumbError: boolean;
  error: string | null;
}

interface ThumbStore {
  thumbs: Record<number, ThumbState>;
  set: (id: number, s: ThumbState) => void;
  ingest: (rows: ThumbResultRow[]) => void;
}

export const useThumbStore = create<ThumbStore>((set) => ({
  thumbs: {},
  set: (id, s) => set((st) => ({ thumbs: { ...st.thumbs, [id]: s } })),
  ingest: (rows) =>
    set((st) => {
      const next = { ...st.thumbs };
      for (const r of rows) {
        if (!r.ok) {
          next[r.mediaId] = {
            status: "error",
            error: r.error ?? "failed",
            noPreview: r.thumbError,
          };
          continue;
        }
        const prev = next[r.mediaId];
        next[r.mediaId] = {
          status: "ok",
          path: r.thumbPath ?? prev?.path,
          color: r.dominantColor ?? prev?.color,
        };
      }
      return { thumbs: next };
    }),
}));

/** ids in flight or queued — prevents duplicate generation work. */
const inFlight = new Set<number>();
const queued = new Set<number>();
let flushTimer: number | null = null;
const FLUSH_MS = 120;
/** Smaller first burst: 96 decodes at once made the first paint stutter. */
const MAX_BATCH = 48;

async function flush() {
  flushTimer = null;
  const ids = Array.from(queued).slice(0, MAX_BATCH);
  if (ids.length === 0) return;
  for (const id of ids) {
    queued.delete(id);
    inFlight.add(id);
  }

  try {
    const rows = await invoke<ThumbResultRow[]>("generate_thumbs", { ids });
    useThumbStore.getState().ingest(rows);
  } catch (e) {
    console.error("generate_thumbs failed", e);
    for (const id of ids) {
      useThumbStore.getState().set(id, { status: "error", error: String(e) });
    }
  } finally {
    for (const id of ids) inFlight.delete(id);
  }

  if (queued.size > 0 && flushTimer === null) {
    flushTimer = window.setTimeout(() => void flush(), 0);
  }
}

/** Lazy enqueue — called with the visible range (+ prefetch margin) only. */
export function enqueueThumbs(ids: number[]) {
  if (!tauriAvailable()) return; // browser preview: nothing to generate
  let added = false;
  for (const id of ids) {
    if (inFlight.has(id) || queued.has(id)) continue;
    const known = useThumbStore.getState().thumbs[id];
    if (known && known.status !== "error") continue;
    queued.add(id);
    added = true;
  }
  if (added && flushTimer === null) {
    flushTimer = window.setTimeout(() => void flush(), FLUSH_MS);
  }
}

/** Ready-to-use <img src> for a cached thumbnail file. */
export function thumbSrc(path: string) {
  return fileSrc(path);
}

/** Seeks, but always resolves — a stuck seek must not block the queue. */
function seekVideo(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    const to = window.setTimeout(resolve, 4_000);
    video.onseeked = () => {
      window.clearTimeout(to);
      resolve();
    };
    video.currentTime = t;
  });
}

/**
 * `seeked` fires BEFORE the frame is painted, so capturing right then is exactly
 * how a thumbnail comes out black. requestVideoFrameCallback reports a frame
 * that is actually ready to draw (WebView2/Chromium has it; rAF is the fallback).
 */
function nextPaintedFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    const withRvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const to = window.setTimeout(() => resolve(), FRAME_WAIT_MS);
    const done = () => {
      window.clearTimeout(to);
      resolve();
    };
    if (typeof withRvfc.requestVideoFrameCallback === "function") {
      withRvfc.requestVideoFrameCallback(() => done());
    } else {
      window.requestAnimationFrame(() => done());
    }
  });
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
) {
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    throw new Error(
      `canvas capture blocked (${e instanceof Error ? e.name : String(e)}) — ` +
        "the asset response is missing CORS headers",
    );
  }
}

/** 4×4 average: dominant color + luma (luma drives the offset retry). */
function sampleCanvas(canvas: HTMLCanvasElement): { color: string; luma: number } {
  const small = document.createElement("canvas");
  small.width = 4;
  small.height = 4;
  const ctx = small.getContext("2d");
  if (!ctx) return { color: "#101012", luma: 0 };
  ctx.drawImage(canvas, 0, 0, 4, 4);
  const d = ctx.getImageData(0, 0, 4, 4).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  const rr = r / n;
  const gg = g / n;
  const bb = b / n;
  return {
    color: `#${hex(r)}${hex(g)}${hex(b)}`,
    luma: 0.2126 * rr + 0.7152 * gg + 0.0722 * bb,
  };
}

/**
 * Video capture is SERIALIZED. A folder with 20 videos used to start 20 hidden
 * decoders at once (preload="auto" downloading whole files), which is what made
 * the app hitch on open and starved some captures into black frames.
 */
const videoQueue: MediaRow[] = [];
const vidThumbsInFlight = new Set<number>();
let videoPumping = false;

/** Frame offsets tried in order: duration/3 alone lands on dark scenes often. */
const SEEK_FRACTIONS = [0.1, 0.3, 0.55];
/** Below this average luma a frame is treated as "not painted yet / too dark". */
const MIN_LUMA = 16;
const FRAME_WAIT_MS = 600;

/** Queue one video frame capture (grid order wins); never a decoder storm. */
export function enqueueVideoThumb(row: MediaRow) {
  if (!tauriAvailable()) return;
  if (vidThumbsInFlight.has(row.id)) return;
  if (videoQueue.some((r) => r.id === row.id)) return;
  if (useThumbStore.getState().thumbs[row.id]) return;
  videoQueue.push(row);
  void pumpVideoQueue();
}

async function pumpVideoQueue() {
  if (videoPumping) return;
  videoPumping = true;
  try {
    while (videoQueue.length > 0) {
      const row = videoQueue.shift();
      if (!row) break;
      // one at a time: the next capture starts only when this one is done
      await processVideoThumb(row);
    }
  } finally {
    videoPumping = false;
  }
}

/**
 * Video thumbnails are rendered in the webview (hidden <video> + canvas) —
 * decoding video in Rust would require an ffmpeg sidecar (v2 option).
 * Writes a 480w JPEG through the fs plugin (scope: $APPCACHE/thumbs/**).
 */
async function processVideoThumb(row: MediaRow): Promise<void> {
  if (!tauriAvailable()) return;
  if (vidThumbsInFlight.has(row.id)) return;
  const known = useThumbStore.getState().thumbs[row.id];
  if (known) return; // ok or failed earlier in this session — never loop
  vidThumbsInFlight.add(row.id);
  useThumbStore.getState().set(row.id, { status: "pending" });

  const video = document.createElement("video");
  video.preload = "metadata"; // one frame needs metadata + a range, not the file
  video.muted = true;
  // The asset protocol answers every response with `Access-Control-Allow-Origin:
  // <window origin>` (tauri src/protocol/asset.rs), so an anonymous CORS request
  // is accepted and the canvas stays UNTAINTED — without this, drawImage/toBlob
  // throws SecurityError and no video ever gets a static frame.
  video.crossOrigin = "anonymous";
  video.src = fileSrc(row.path);

  try {
    const meta = await new Promise<{ duration: number; w: number; h: number }>(
      (resolve, reject) => {
        const to = window.setTimeout(
          () => reject(new Error("metadata timeout")),
          8000,
        );
        video.onloadedmetadata = () => {
          window.clearTimeout(to);
          resolve({
            duration: video.duration || 0,
            w: video.videoWidth || 0,
            h: video.videoHeight || 0,
          });
        };
        video.onerror = () => {
          window.clearTimeout(to);
          reject(new Error("video load error"));
        };
      },
    );

    const targetW = 480;
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = Math.max(
      1,
      Math.round((targetW * (meta.h || 270)) / (meta.w || 480)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    // Probe frame offsets until one actually looks like a picture: black tiles
    // came from (a) fade-ins at duration/3 and (b) drawing before the decoder
    // painted the seeked frame.
    let probe: { color: string; luma: number } | null = null;
    for (const frac of SEEK_FRACTIONS) {
      const t = meta.duration > 0 ? Math.max(0.1, meta.duration * frac) : 0.1;
      await seekVideo(video, t);
      await nextPaintedFrame(video);
      drawFrame(ctx, video, canvas);
      const sample = sampleCanvas(canvas);
      if (!probe || sample.luma > probe.luma) probe = sample;
      if (probe.luma >= MIN_LUMA) break;
    }
    const color = probe?.color;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    if (!blob) throw new Error("toBlob failed");

    const dir = await join(await appCacheDir(), "thumbs");
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const file = await join(dir, `${row.id}.jpg`);
    await writeFile(file, new Uint8Array(await blob.arrayBuffer()));

    const db = await getDb();
    await db.execute(
      "UPDATE media SET thumb_path = ?1, thumb_mtime = mtime, dominant_color = ?2, duration_ms = COALESCE(duration_ms, ?3), width = COALESCE(width, ?4), height = COALESCE(height, ?5) WHERE id = ?6",
      [
        file,
        color ?? null,
        Math.round((meta.duration || 0) * 1000),
        meta.w || null,
        meta.h || null,
        row.id,
      ],
    );

    useThumbStore.getState().set(row.id, { status: "ok", path: file, color });
  } catch (e) {
    console.error("video thumb failed", row.path, e);
    useThumbStore.getState().set(row.id, { status: "error", error: String(e) });
  } finally {
    video.src = "";
    vidThumbsInFlight.delete(row.id);
  }
}

/** Routes rows to the right generator: images → Rust, videos → webview. */
export function enqueueRows(rows: MediaRow[]) {
  if (!tauriAvailable()) return;
  const imageIds: number[] = [];
  for (const r of rows) {
    // rows already marked as undecodable in the DB are never retried
    if (r.thumbError) continue;
    const known = useThumbStore.getState().thumbs[r.id];
    // "never retry in this session": a failure here is logged once, not per scroll
    if (known) continue;
    if (r.kind === "image") imageIds.push(r.id);
    else enqueueVideoThumb(r);
  }
  enqueueThumbs(imageIds);
}