import type { MediaRow } from "@/lib/api";
import {
  GRID_GAP,
  TARGET_ROW_H,
  computeJustifiedRows,
  computeSquareRows,
  ratioOf,
} from "@/lib/justified";
import { dayKey, formatDayLabel } from "@/lib/format";
import type { SortKey, ViewMode } from "@/state/library-ui";

/**
 * Turns an ordered media list into the flat item list react-virtuoso renders
 * (date headers + rows), for every view mode. Pure + O(n) so a resize can
 * repack the whole library without touching the DOM.
 */

export const HEADER_HEIGHT = 52;
export const LIST_ROW_HEIGHT = 64;

/** Grid metrics that the density setting drives (FIX 4b). */
export interface GridMetrics {
  targetH: number;
  gap: number;
}

/** Fallback metrics when a caller does not pass the user's density preset. */
export const DEFAULT_METRICS: GridMetrics = {
  targetH: TARGET_ROW_H,
  gap: GRID_GAP,
};

export interface GridCell {
  media: MediaRow;
  w: number;
  h: number;
  /** left offset inside the row, computed with the density gutter (FIX 4b) */
  x: number;
}

export type GridItem =
  | { kind: "header"; key: string; label: string; count: number; height: number; group: number }
  | { kind: "cells"; key: string; cells: GridCell[]; height: number; group: number }
  | { kind: "listrow"; key: string; media: MediaRow; height: number; group: number };

export interface GridGroup {
  key: string;
  label: string;
  count: number;
}

export interface BuiltGrid {
  items: GridItem[];
  groups: GridGroup[];
  /** item index -> group index, for the sticky header */
  groupOf: number[];
}

/** Date headers only make sense while the list is date-ordered. */
export function isGroupedSort(sort: SortKey): boolean {
  return sort === "date" || sort === "added";
}

export function buildGrid(
  rows: MediaRow[],
  width: number,
  view: ViewMode,
  sort: SortKey,
  lang: string,
  metrics: GridMetrics = DEFAULT_METRICS,
): BuiltGrid {
  const items: GridItem[] = [];
  const groups: GridGroup[] = [];
  const groupOf: number[] = [];
  const grouped = isGroupedSort(sort);

  let start = 0;
  while (start < rows.length) {
    let end = rows.length;
    const first = rows[start];
    let group: GridGroup = { key: "all", label: "", count: rows.length };
    if (grouped) {
      const key = dayKey(first.mtime);
      end = start;
      while (end < rows.length && dayKey(rows[end].mtime) === key) end += 1;
      group = { key, label: formatDayLabel(first.mtime, lang), count: end - start };
    }
    const slice = rows.slice(start, end);
    const gi = groups.length;
    groups.push(group);

    if (grouped) {
      // BUG: the key used to be just `h-${group.key}` — but rows can be sorted
      // by ADDED date while grouped by SHOT date (mtime), so one day can yield
      // SEVERAL non-contiguous groups with the SAME key. Duplicate keys break
      // react-virtuoso's internal size map (its contract: keys are unique) and
      // the grid painted date headers with no rows under them. The group index
      // makes the key unique no matter how the rows are ordered.
      items.push({
        kind: "header",
        key: `h-${gi}-${group.key}`,
        label: group.label,
        count: group.count,
        height: HEADER_HEIGHT,
        group: gi,
      });
      groupOf.push(gi);
    }

    if (view === "list") {
      for (const media of slice) {
        items.push({
          kind: "listrow",
          key: `l-${media.id}`,
          media,
          height: LIST_ROW_HEIGHT,
          group: gi,
        });
        groupOf.push(gi);
      }
    } else {
      const layout =
        view === "square"
          ? computeSquareRows(slice.length, width, metrics.targetH, metrics.gap)
          : computeJustifiedRows(
              slice.map((m) => ratioOf(m.kind, m.width, m.height)),
              width,
              metrics.targetH,
              metrics.gap,
            );
      for (const row of layout) {
        const cells: GridCell[] = [];
        let x = 0;
        for (let ci = 0; ci < row.indices.length; ci += 1) {
          const w = row.widths[ci];
          cells.push({ media: slice[row.indices[ci]], w, h: row.height, x });
          x += w + metrics.gap;
        }
        items.push({
          kind: "cells",
          key: `r-${cells[0].media.id}`,
          cells,
          height: row.height + metrics.gap,
          group: gi,
        });
        groupOf.push(gi);
      }
    }

    start = end;
  }

  return { items, groups, groupOf };
}
