import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { getDb } from "@/lib/db";
import { fileSrc } from "@/lib/assets";
import type { MediaRow } from "@/lib/api";

export interface ThumbState {
  status: "pending" | "ok" | "error";
  path?: string;
  color?: string; // dominant color "#RRGGBB"
  error?: string;
}

interface ThumbResultRow {
  mediaId: number;
  thumbPath: string | null;
  dominantColor: string | null;
  ok: boolean;
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
          next[r.mediaId] = { status: "error", error: r.error ?? "failed" };
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
const MAX_BATCH = 96;

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

const vidThumbsInFlight = new Set<number>();

/**
 * Video thumbnails are rendered in the webview (hidden <video> + canvas) —
 * decoding video in Rust would require an ffmpeg sidecar (v2 option).
 * Writes a 480w JPEG through the fs plugin (scope: $APPCACHE/thumbs/**).
 */
export async function makeVideoThumb(row: MediaRow): Promise<void> {
  if (vidThumbsInFlight.has(row.id)) return;
  const known = useThumbStore.getState().thumbs[row.id];
  if (known?.status === "ok") return;
  vidThumbsInFlight.add(row.id);
  useThumbStore.getState().set(row.id, { status: "pending" });

  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
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

    const seekTo = Math.min(1, meta.duration > 0 ? meta.duration / 3 : 1);
    if (seekTo > 0) {
      await new Promise<void>((resolve) => {
        const to = window.setTimeout(() => resolve(), 3000);
        video.onseeked = () => {
          window.clearTimeout(to);
          resolve();
        };
        video.currentTime = seekTo;
      });
    }

    const targetW = 480;
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = Math.max(
      1,
      Math.round((targetW * (meta.h || 270)) / (meta.w || 480)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    if (!blob) throw new Error("toBlob failed");

    // dominant color from a 4x4 downscale
    const small = document.createElement("canvas");
    small.width = 4;
    small.height = 4;
    const sctx = small.getContext("2d");
    let color: string | undefined;
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, 4, 4);
      const d = sctx.getImageData(0, 0, 4, 4).data;
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
      color = `#${hex(r)}${hex(g)}${hex(b)}`;
    }

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
  const imageIds: number[] = [];
  for (const r of rows) {
    const known = useThumbStore.getState().thumbs[r.id];
    if (known && known.status !== "error") continue;
    if (r.kind === "image") imageIds.push(r.id);
    else void makeVideoThumb(r);
  }
  enqueueThumbs(imageIds);
}