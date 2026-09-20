import { fileSrc, tauriAvailable } from "@/lib/assets";
import type { MediaRow } from "@/lib/api";

/**
 * Viewer warm-up: FULL-SIZE neighbour preloading (U1 — "фото открывается с
 * секундной задержкой"). The old contract prefetched only the 480w thumbs,
 * so every arrow press / open still paid a full read+decode of the original.
 *
 * Rules (so the trick never becomes the freeze it removes):
 *  - IMAGES ONLY — a video original is never pulled into a hidden element;
 *  - IDLE-PLANNED: neighbours enter the pipeline via requestIdleCallback
 *    (1.5 s timeout) so a slow mechanical drive never competes with the
 *    current frame's decode;
 *  - TINY CACHE (8 srcs): every extra warm neighbour beyond that evicts the
 *    oldest, so paging 200 photos cannot pin hundreds of MB of decoded bitmaps
 *    — hidden <img> decodes are retained by the WebView until the src drops;
 *  - PRESS-START: the grid calls `armOpenWarm` on pointerdown and
 *    `openViewer` calls `keepWarm(id)` on click — a press that turned out to
 *    be a selection/context-menu gesture releases its image again.
 */

/** srcs the WebView keeps decoded — the current press + nearest neighbours */
const warm = new Map<number, HTMLImageElement>();
/** eviction order, oldest first */
const warmOrder: number[] = [];
const WARM_LIMIT = 8;

function keep(id: number, img: HTMLImageElement): void {
  warm.set(id, img);
  warmOrder.push(id);
  while (warmOrder.length > WARM_LIMIT) {
    const oldest = warmOrder.shift();
    if (oldest === undefined || oldest === id) continue;
    release(oldest);
  }
}

function release(id: number): void {
  const img = warm.get(id);
  if (!img) return;
  // dropping src is the ONLY thing that actually frees the decoded bitmap
  img.src = "";
  warm.delete(id);
}

/** Cancel-safe idle scheduling (browser QA has no requestIdleCallback). */
function onIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(fn, { timeout: 1500 });
    return () => cancelIdleCallback(handle);
  }
  const t = window.setTimeout(fn, 250);
  return () => window.clearTimeout(t);
}

/**
 * Warm the neighbours of `index` (full originals, images only). Returns a
 * cleanup that cancels anything still pending — call it on the next index
 * change so fast paging never stacks decodes.
 */
export function preloadViewerNeighbors(queue: MediaRow[], index: number): () => void {
  if (!tauriAvailable()) return () => undefined;
  const cancels: (() => void)[] = [];
  for (const d of [-1, 1, -2, 2]) {
    const row = queue[index + d];
    if (!row || row.kind !== "image") continue;
    if (warm.has(row.id)) continue;
    cancels.push(
      onIdle(() => {
        if (warm.has(row.id)) return;
        const img = new Image();
        img.decoding = "async";
        img.src = fileSrc(row.path);
        keep(row.id, img);
      }),
    );
  }
  return () => cancels.forEach((c) => c());
}

/**
 * Grid card press: start fetching the original BEFORE the click fires, so by
 * the time the viewer mounts the image is already in flight (saves the full
 * round-trip for the common case). The viewer MUST call `keepWarm` for the
 * row it opens — otherwise it is released on the next warm (a press can be a
 * selection toggle, not an open).
 */
export function armOpenWarm(row: MediaRow): void {
  if (!tauriAvailable() || row.kind !== "image" || warm.has(row.id)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = fileSrc(row.path);
  keep(row.id, img);
}

/** The viewer opened this row: pin its warm entry (refresh eviction order). */
export function keepWarm(id: number): void {
  const img = warm.get(id);
  if (!img) return;
  const at = warmOrder.indexOf(id);
  if (at >= 0) warmOrder.splice(at, 1);
  warmOrder.push(id);
}
