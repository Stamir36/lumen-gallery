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

export interface GridCell {
  media: MediaRow;
  w: number;
  h: number;
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
      items.push({
        kind: "header",
        key: `h-${group.key}`,
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
          ? computeSquareRows(slice.length, width, TARGET_ROW_H, GRID_GAP)
          : computeJustifiedRows(
              slice.map((m) => ratioOf(m.kind, m.width, m.height)),
              width,
              TARGET_ROW_H,
              GRID_GAP,
            );
      for (const row of layout) {
        const cells: GridCell[] = row.indices.map((k, ci) => ({
          media: slice[k],
          w: row.widths[ci],
          h: row.height,
        }));
        items.push({
          kind: "cells",
          key: `r-${cells[0].media.id}`,
          cells,
          height: row.height + GRID_GAP,
          group: gi,
        });
        groupOf.push(gi);
      }
    }

    start = end;
  }

  return { items, groups, groupOf };
}
