import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { queryClient } from "@/lib/queryClient";
import type { MediaRow } from "@/lib/api";

/**
 * Thumbnail store + queue.
 *
 * Contract (S1):
 *  - WARM: a row that already carries `thumb_path` renders instantly through
 *    convertFileSrc — no request, no shimmer (S1.1);
 *  - ONE queue for the whole app in sub-batches of 24, visible-first (S1.2);
 *    decodes are deduped by (id, mtime, size), so a version is asked once;
 *  - PUSH: the writer's `thumbs-ready` marks a row durable and patches the query
 *    cache; `thumb-result` paints a tile the moment its row is done (S1.3);
 *  - VERSIONED: a changed file (mtime or size) is re-asked, included rows that
 *    failed to decode before (S1.4);
 *  - HONEST: shimmer → thumb → neutral tile + mono ext chip. Never a broken
 *    glyph, never an error marker on a file the WebView can decode (S1.5/S1.6).
 */

export interface ThumbState {
  status: "pending" | "ok" | "error";
  path?: string;
  color?: string; // dominant color "#RRGGBB"
  error?: string;
  /** decode failed in every decoder — render the neutral "no preview" tile */
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
  /** per-id retry budget: a tile must never loop forever */
  attempts: Record<number, number>;
  set: (id: number, s: ThumbState) => void;
  /** drop one entry so the next enqueue may regenerate it */
  forget: (id: number) => void;
  ingest: (rows: ThumbResultRow[]) => void;
}

export const useThumbStore = create<ThumbStore>((set) => ({
  thumbs: {},
  attempts: {},
  set: (id, s) => set((st) => ({ thumbs: { ...st.thumbs, [id]: s } })),
  forget: (id) => {
    // B1: `asked` (id -> version) is what stops duplicate work, but it also made
    // a tile's retry path DEAD CODE — `enqueueRows` skipped the row forever and
    // the tile shimmered until the app restarted. Forgetting a row must clear
    // its request marker too, or "forget + enqueue" is a no-op.
    asked.delete(id);
    set((st) => {
      const thumbs = { ...st.thumbs };
      delete thumbs[id];
      return { thumbs, attempts: { ...st.attempts, [id]: (st.attempts[id] ?? 0) + 1 } };
    });
  },
  ingest: (rows) =>
    set((st) => {
      const next = { ...st.thumbs };
      for (const r of rows) {
        if (!r.ok) {
          const prev = next[r.mediaId];
          next[r.mediaId] = {
            status: "error",
            error: r.error ?? "failed",
            noPreview: r.thumbError,
            // keep the placeholder color: a failed decode still gets a tonal tile
            color: prev?.color,
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

/** the file version the thumbnail cache is keyed by (mirrors the Rust side) */
function versionOf(row: MediaRow) {
  return `${row.mtime}:${row.size}`;
}

/** ids in flight or queued — prevents duplicate generation work. */
const inFlight = new Set<number>();
const queued = new Set<number>();
/** (id -> version) already requested in this session (S1.2 dedupe) */
const asked = new Map<number, string>();
/** Visible-first priority. NOT a drop list: overscan cards stay mounted, so
 *  dropping an id could leave that tile shimmering forever — offscreen work is
 *  deferred to a later flush instead of being cancelled. */
let viewportIds = new Set<number>();
let flushTimer: number | null = null;
const FLUSH_MS = 60;
/** sub-batch size (S1.2): the first cold tiles must land under ~1 s */
const MAX_BATCH = 24;
/** …but a FAST SCROLL changes the arithmetic (F8): a fling paints dozens of
 *  new tiles at once; at 24/flush they were visibly late. 48/flush halves the
 *  latency for the visible range — the engine decodes in parallel anyway, so
 *  the wall-clock cost is ≈ the slowest image, not the sum. */
const MAX_BATCH_SCROLL = 48;
/**
 * Above this many queued ids a flush DROPS offscreen work instead of deferring
 * it (B7/P0-0d). Flinging through the library used to enqueue every row ever
 * mounted; since video capture is serialized that became minutes of background
 * decoding competing with the tile the user is looking at. A dropped id clears
 * its `asked` entry, so it is simply asked again the moment it scrolls back into
 * the visible range — dropping is safe, not lossy.
 */
const QUEUE_DROP_THRESHOLD = 200;
/** one log line per storm, not per flush */
let droppedSinceLog = 0;
let lastDropLogAt = 0;

/** The grid publishes its visible range so on-screen tiles are served first. */
export function setViewportIds(ids: number[]) {
  viewportIds = new Set(ids);
}

/**
 * WARM SEED (S1.1): rows that already have a cached thumbnail render straight
 * from the DB value — no enqueue, no placeholder flash.
 */
export function seedThumbs(rows: MediaRow[]) {
  const st = useThumbStore.getState();
  const next = { ...st.thumbs };
  let touched = false;
  for (const r of rows) {
    if (!r.thumbPath) continue;
    const cur = next[r.id];
    if (cur?.status === "ok" && cur.path === r.thumbPath) continue;
    next[r.id] = {
      status: "ok",
      path: r.thumbPath,
      color: r.dominantColor ?? cur?.color,
    };
    asked.set(r.id, versionOf(r));
    touched = true;
  }
  if (touched) useThumbStore.setState({ thumbs: next });
}

async function flush() {
  flushTimer = null;
  if (queued.size === 0) return;

  // visible first; anything offscreen waits for the next flush instead of
  // competing with what the user is actually looking at
  const onScreen: number[] = [];
  const offscreen: number[] = [];
  for (const id of queued) {
    if (viewportIds.size === 0 || viewportIds.has(id)) onScreen.push(id);
    else offscreen.push(id);
  }

  // P0-0d: a scroll storm must not queue minutes of background work. Above the
  // threshold offscreen ids are dropped (and un-asked so they come back).
  if (queued.size > QUEUE_DROP_THRESHOLD && offscreen.length > 0) {
    let dropped = 0;
    for (const id of offscreen) {
      if (queued.delete(id)) {
        asked.delete(id);
        dropped++;
      }
    }
    if (dropped > 0) {
      droppedSinceLog += dropped;
      const now = Date.now();
      if (now - lastDropLogAt > 3_000) {
        console.info(
          `[perf] thumb queue dropped ${droppedSinceLog} offscreen ids (visible-first kept)`,
        );
        droppedSinceLog = 0;
        lastDropLogAt = now;
      }
      // keep the visible ones in this same pass; the first loop already
      // collected them, so nothing to re-add — just stop deferring the rest
      offscreen.length = 0;
    }
  }

  // F8: under a scroll storm (queue above the drop threshold) take the bigger
  // batch — the visible range must be served in ONE pass, not two
  const cap = queued.size > QUEUE_DROP_THRESHOLD ? MAX_BATCH_SCROLL : MAX_BATCH;
  const ids = [...onScreen, ...offscreen].slice(0, cap);
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
    if (known && known.status === "ok") continue;
    queued.add(id);
    added = true;
  }
  if (added && flushTimer === null) {
    flushTimer = window.setTimeout(() => void flush(), FLUSH_MS);
  }
}

/**
 * Drops all in-memory thumb state (after the thumbnail cache is wiped): the
 * rows are refetched with empty thumb fields and the grid regenerates every
 * visible tile, videos included.
 */
export function resetThumbs() {
  useThumbStore.setState({ thumbs: {}, attempts: {} });
  inFlight.clear();
  queued.clear();
  asked.clear();
  videoQueue.length = 0;
  if (readyTimer !== null) {
    window.clearTimeout(readyTimer);
    readyTimer = null;
  }
  readyBuf = new Set();
  droppedSinceLog = 0;
  lastDropLogAt = 0;
}

/** Ready-to-use <img src> for a cached thumbnail file. */
export function thumbSrc(path: string) {
  return fileSrc(path);
}

/**
 * The writer tells us a thumbnail row is DURABLE (S1.3): patch the cached
 * MediaRow so a later mount renders from data (warm path) instead of waiting
 * for a refetch.
 *
 * P0-0b: this used to spread EVERY cached row on every flush. During a cold
 * generation storm that is the main-thread cost the user felt as a freeze.
 * Two guards now: (1) a per-query PROBE — a cached query that shares no id with
 * the batch (folder views, other filters, the other layout) returns untouched
 * without allocating anything; (2) a size cap, so one pass never maps an
 * unbounded row set.
 */
const PATCH_MAX_ROWS = 4_000;

function patchCachedRows(ids: number[]) {
  if (ids.length === 0) return;
  const thumbs = useThumbStore.getState().thumbs;
  const wanted = new Set(ids);
  queryClient.setQueriesData<MediaRow[]>({ queryKey: ["media"] }, (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    // cheap probe first: a Set lookup per row, no allocation
    const probe = Math.min(rows.length, PATCH_MAX_ROWS);
    let hits = 0;
    for (let i = 0; i < probe; i++) {
      if (wanted.has(rows[i].id)) hits++;
    }
    if (hits === 0) return rows;

    let touched = false;
    const next = rows.slice();
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (!wanted.has(r.id)) continue;
      const t = thumbs[r.id];
      if (!t?.path || r.thumbPath === t.path) continue;
      next[i] = { ...r, thumbPath: t.path, dominantColor: t.color ?? r.dominantColor };
      touched = true;
    }
    return touched ? next : rows;
  });
}

let bridgeStarted = false;

/**
 * P0-0a: `thumbs-ready` arrives once per WRITER flush (64 items / 200 ms), and
 * a cold generation storm produces dozens of flushes back to back — one patch
 * pass each, all on the main thread while the user is paging the lightbox.
 * Buffer the ids and apply ONE pass per coalesced window instead.
 */
const READY_COALESCE_MS = 120;
let readyBuf = new Set<number>();
let readyTimer: number | null = null;

function scheduleReadyPatch(ids: number[]) {
  for (const id of ids) readyBuf.add(id);
  if (readyTimer !== null) return;
  readyTimer = window.setTimeout(() => {
    readyTimer = null;
    const batch = [...readyBuf];
    readyBuf = new Set();
    if (batch.length > 0) patchCachedRows(batch);
  }, READY_COALESCE_MS);
}

/**
 * ONE subscription for the whole app: `thumb-result` streams per-row results as
 * they are rendered, `thumbs-ready` (emitted after the writer's transaction
 * commits) marks them durable.
 */
export function startThumbBridge() {
  if (bridgeStarted || !tauriAvailable()) return;
  bridgeStarted = true;
  void listen<ThumbResultRow>("thumb-result", (e) => {
    useThumbStore.getState().ingest([e.payload]);
  });
  void listen<{ ids: number[] }>("thumbs-ready", (e) => {
    scheduleReadyPatch(e.payload.ids ?? []);
  });
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

/** Content type from magic bytes — Rust said "undetermined", so sniff here. */
function sniffType(b: Uint8Array): string {
  if (b.length > 11 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 12 && b[8] === 0x66 && b[9] === 0x74 && b[10] === 0x79 && b[11] === 0x70)
    return "image/avif"; // ISOBMFF ftyp — avif/heif family
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45)
    return "image/webp"; // RIFF….WEBP
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b.length > 2 && b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b.length > 4 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return "application/octet-stream";
}

const BROWSER_THUMB_W = 480;

/**
 * PERSISTENT BROWSER FALLBACK (S1.5). Rust could not decode the file, but the
 * WebView often still can (platform HEIC/AVIF/WebP codecs). Decode it once, write
 * the JPEG into the thumbnail cache and record it through the single writer, so
 * the success survives a remount, a scroll away and a restart instead of being
 * re-decoded (or lost) on every mount.
 *
 * The negative marker is keyed by FILE VERSION, never by id forever: a replaced
 * file gets another chance.
 */
export async function ensureBrowserThumb(row: MediaRow): Promise<void> {
  if (!tauriAvailable() || row.kind !== "image") return;
  const store = useThumbStore.getState();
  const cur = store.thumbs[row.id];
  if (cur?.status === "ok" || cur?.status === "pending") return;
  const key = `thumbNativeFailed:${row.id}:${versionOf(row)}`;
  try {
    if (localStorage.getItem(key) === "1") return;
  } catch {
    /* private mode: no negative cache, just try */
  }
  store.set(row.id, { status: "pending" });
  try {
    // the fs plugin read is capability-scoped to media roots + thumbs cache
    const bytes = await readFile(row.path);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: sniffType(bytes) }));
    const w = Math.min(BROWSER_THUMB_W, bitmap.width);
    const h = Math.max(1, Math.round((w * bitmap.height) / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const color = sampleCanvas(canvas).color;
    const jpeg = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.82),
    );
    if (!jpeg) throw new Error("toBlob failed");

    const dir = await join(await appCacheDir(), "thumbs");
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const file = await join(dir, `${row.id}.jpg`);
    await writeFile(file, new Uint8Array(await jpeg.arrayBuffer()));
    await invoke("thumb_record", {
      id: row.id,
      thumbPath: file,
      dominantColor: color,
      durationMs: null,
      width: w,
      height: h,
    });
    useThumbStore.getState().set(row.id, { status: "ok", path: file, color });
  } catch (e) {
    console.warn("browser thumb fallback failed", row.path, e);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* nothing to remember it with */
    }
    useThumbStore.getState().set(row.id, { status: "error", noPreview: true });
  }
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
  if (row.thumbPath) return; // already warm in the DB
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
 * Writes a 480w JPEG through the fs plugin (scope: $APPCACHE/thumbs/**) and
 * records it through `thumb_record`, i.e. the SINGLE WRITER (S1.12) — the old
 * direct sql-plugin UPDATE was the 1.3-1.7 s slow statement in the user's log.
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

    await invoke("thumb_record", {
      id: row.id,
      thumbPath: file,
      dominantColor: color ?? "#101012",
      durationMs: Math.round((meta.duration || 0) * 1000),
      width: meta.w || null,
      height: meta.h || null,
    });

    useThumbStore.getState().set(row.id, { status: "ok", path: file, color });
  } catch (e) {
    console.error("video thumb failed", row.path, e);
    useThumbStore.getState().set(row.id, { status: "error", error: String(e) });
  } finally {
    video.src = "";
    vidThumbsInFlight.delete(row.id);
  }
}

/**
 * Routes rows to the right generator: images → Rust, videos → webview.
 * Only rows that actually need work are enqueued (S1.1/S1.2): a warm row is
 * seeded and never asked for, and a given file VERSION is asked at most once —
 * including rows that failed to decode earlier, so a replaced file recovers
 * instead of keeping a negative entry forever.
 */
export function enqueueRows(rows: MediaRow[]) {
  if (!tauriAvailable()) return;
  seedThumbs(rows);
  const imageIds: number[] = [];
  for (const r of rows) {
    const version = versionOf(r);
    if (asked.get(r.id) === version) continue;
    const known = useThumbStore.getState().thumbs[r.id];
    if (known?.status === "ok" || known?.status === "pending") continue;
    asked.set(r.id, version);
    if (r.kind === "image") imageIds.push(r.id);
    else enqueueVideoThumb(r);
  }
  enqueueThumbs(imageIds);
}