import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaRow } from "@/lib/api";
import { GRID_GAP, computeMasonryColumns, ratioOf } from "@/lib/justified";
import { useElementWidth, useRafScroll } from "@/lib/hooks";
import { formatCount } from "@/lib/api";
import { MediaCard } from "./MediaCard";

/**
 * Column-balanced masonry (each item keeps its aspect ratio, shortest column
 * wins) with a hand-rolled vertical virtual window.
 *
 * Why not react-virtuoso: masonry needs absolute positioning, which the
 * library does not virtualize — so the window is computed from scrollTop with
 * rAF throttling and only intersecting tiles mount.
 *
 * TODO(perf): above MASONRY_MAX items we render a bounded slice instead of
 * freezing. Revisit with a measured windowed layout (or keep the cap) once the
 * 50k target is on real hardware.
 */
export const MASONRY_MAX = 2000;

export function Masonry({
  rows,
  radius,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  rows: MediaRow[];
  radius: number;
  selectionMode: boolean;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller, 1200);
  // 36px gutter each side + the 8px scrollbar (DESIGN.md §9) — mirrors the
  // justified path so all modes share one content column.
  const usableWidth = Math.max(160, width - 80);

  const limited = rows.length > MASONRY_MAX;
  const visibleRows = limited ? rows.slice(0, MASONRY_MAX) : rows;

  const ratios = useMemo(
    () => visibleRows.map((m) => ratioOf(m.kind, m.width, m.height)),
    [visibleRows],
  );
  const cols = Math.max(2, Math.min(6, Math.round(usableWidth / 300)));

  const packed = useMemo(
    () => computeMasonryColumns(ratios, usableWidth, cols, GRID_GAP),
    [ratios, usableWidth, cols],
  );

  const [view, setView] = useState({ top: 0, bottom: 1400 });
  const onScroll = useCallback((top: number, height: number) => {
    setView((prev) =>
      prev.top === top && prev.bottom === top + height
        ? prev
        : { top, bottom: top + height },
    );
  }, []);
  useRafScroll(scroller, onScroll);

  const pad = 700;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const columnWidth = packed.colW;
  const tiles: { media: MediaRow; x: number; y: number; h: number }[] = [];
  packed.columns.forEach((col, c) => {
    const x = c * (columnWidth + GRID_GAP);
    col.items.forEach((itemIndex, k) => {
      const y = col.offsets[k];
      const h = col.heights[k];
      if (y + h < view.top - pad || y > view.bottom + pad) return;
      tiles.push({ media: visibleRows[itemIndex], x, y, h });
    });
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {limited && (
        <div className="mx-9 mb-3 flex h-9 shrink-0 items-center rounded-control bg-surface-2 px-3 font-mono text-[11px] tracking-[0.08em] text-ttertiary">
          {t("grid.masonry_limited", {
            shown: formatCount(MASONRY_MAX),
            total: formatCount(rows.length),
          })}
        </div>
      )}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="relative mx-9 pb-24" style={{ height: packed.total }}>
          {tiles.map(({ media, x, y, h }) => (
            <div
              key={media.id}
              className="absolute left-0 top-0 will-change-transform"
              style={{
                width: columnWidth,
                height: h,
                transform: `translate3d(${x}px, ${y}px, 0)`,
              }}
            >
              <MediaCard
                media={media}
                radius={radius}
                selectionMode={selectionMode}
                selected={selected.has(media.id)}
                onToggleSelect={onToggleSelect}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
