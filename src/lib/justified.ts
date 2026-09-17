/**
 * Justified collage layout math (SPEC §4: target row height 220, gap 8).
 *
 * Pure functions — no DOM, no React — so the grid can recompute rows on
 * resize in O(n) without touching the renderer.
 */

export const TARGET_ROW_H = 220;
export const GRID_GAP = 8;

/** One laid-out row: item indices plus the resolved width/height of each cell. */
export interface JustifiedLayoutRow {
  indices: number[];
  widths: number[];
  height: number;
}

/**
 * Greedy justified packing: keep appending items until scaling them to the
 * available width drops below `targetH`, then close the row at the exact
 * height that fills the width edge to edge.
 *
 * The trailing row is NOT stretched (it keeps natural aspect widths at
 * `targetH` max) — stretching a 2-item tail across 1600px looks broken.
 */
export function computeJustifiedRows(
  ratios: number[],
  width: number,
  targetH = TARGET_ROW_H,
  gap = GRID_GAP,
): JustifiedLayoutRow[] {
  if (width <= 0 || ratios.length === 0) return [];
  const rows: JustifiedLayoutRow[] = [];
  let current: number[] = [];
  let ratioSum = 0;

  const close = (indices: number[], sum: number) => {
    const natural = (width - gap * (indices.length - 1)) / sum;
    const height = Math.min(targetH, natural);
    const widths = indices.map((i) => ratios[i] * height);
    // Last cell absorbs rounding so the row ends flush with the gutter.
    const used = widths.reduce((a, b) => a + b, 0) + gap * (indices.length - 1);
    widths[widths.length - 1] = Math.max(1, widths[widths.length - 1] + (width - used));
    return { indices, widths, height };
  };

  for (let i = 0; i < ratios.length; i += 1) {
    current.push(i);
    ratioSum += ratios[i];
    const height = (width - gap * (current.length - 1)) / ratioSum;
    if (height <= targetH) {
      rows.push(close(current, ratioSum));
      current = [];
      ratioSum = 0;
    }
  }
  if (current.length > 0) rows.push(close(current, ratioSum));
  return rows;
}

/** Square mode: uniform cells packed `cols` per row. */
export function computeSquareRows(
  count: number,
  width: number,
  targetH = TARGET_ROW_H,
  gap = GRID_GAP,
): JustifiedLayoutRow[] {
  if (width <= 0 || count <= 0) return [];
  const cols = Math.max(1, Math.round((width + gap) / (targetH + gap)));
  const size = (width - gap * (cols - 1)) / cols;
  const rows: JustifiedLayoutRow[] = [];
  for (let i = 0; i < count; i += cols) {
    const indices: number[] = [];
    for (let j = i; j < Math.min(i + cols, count); j += 1) indices.push(j);
    rows.push({ indices, widths: indices.map(() => size), height: size });
  }
  return rows;
}

/** Aspect ratio with graceful fallbacks (videos default 16:9, images 3:2). */
export function ratioOf(
  kind: "image" | "video",
  width: number | null,
  height: number | null,
): number {
  if (width && height && width > 0 && height > 0) {
    return clampRatio(width / height);
  }
  return kind === "video" ? 16 / 9 : 3 / 2;
}

/** Extreme panoramas/verticals would wreck a row — clamp to sane bounds. */
function clampRatio(r: number): number {
  return Math.min(3.6, Math.max(0.4, r));
}

export interface MasonryColumn {
  /** item indices placed in this column, top to bottom */
  items: number[];
  /** y offset inside the column (CSS px), parallel to `items` */
  offsets: number[];
  heights: number[];
  total: number;
}

/**
 * Column-balanced masonry: each item keeps its aspect ratio and goes to the
 * currently shortest column (how Photos/Pinterest behave).
 */
export function computeMasonryColumns(
  ratios: number[],
  width: number,
  cols: number,
  gap = GRID_GAP,
): { columns: MasonryColumn[]; colW: number; total: number } {
  const colW = Math.max(1, (width - gap * (cols - 1)) / cols);
  const columns: MasonryColumn[] = Array.from({ length: cols }, () => ({
    items: [],
    offsets: [],
    heights: [],
    total: 0,
  }));
  ratios.forEach((ratio, i) => {
    let target = 0;
    for (let c = 1; c < cols; c += 1) {
      if (columns[c].total < columns[target].total) target = c;
    }
    const col = columns[target];
    col.items.push(i);
    col.offsets.push(col.total);
    const h = colW / ratio;
    col.heights.push(h);
    col.total += h + gap;
  });
  const total = Math.max(...columns.map((c) => c.total)) - gap;
  return { columns, colW, total: Math.max(0, total) };
}
