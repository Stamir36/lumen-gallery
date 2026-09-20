import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaRow } from "@/lib/api";
import { computeMasonryColumns, ratioOf } from "@/lib/justified";
import { DENSITY_PARAMS, useAppSettings } from "@/lib/settings";
import { useElementWidth, useRafScroll } from "@/lib/hooks";
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
  onActivate,
  revealId,
  onRevealed,
  onPressStart,
}: {
  rows: MediaRow[];
  radius: number;
  selectionMode: boolean;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  /** click on the card body opens the viewer (STEP 1) */
  onActivate: (id: number) => void;
  /** item the viewer was showing — scroll the masonry back to it on close */
  revealId?: number | null;
  onRevealed?: () => void;
  /** U1: card pointerdown — start fetching the original before the click */
  onPressStart?: (id: number) => void;
}) {
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
  // FIX 4b: density drives the masonry column width and the gutter
  const density = useAppSettings((s) => s.gridDensity);
  const { colW, gap } = DENSITY_PARAMS[density];
  const cols = Math.max(2, Math.min(6, Math.round(usableWidth / colW)));

  const packed = useMemo(
    () => computeMasonryColumns(ratios, usableWidth, cols, gap),
    [ratios, usableWidth, cols, gap],
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

  /** media id → its y offset in the packed layout (for return-to-item) */
  const positionOf = useMemo(() => {
    const map = new Map<number, number>();
    packed.columns.forEach((col) => {
      col.items.forEach((itemIndex, k) => {
        const row = visibleRows[itemIndex];
        if (row) map.set(row.id, col.offsets[k]);
      });
    });
    return map;
  }, [packed, visibleRows]);

  // Return-to-item (STEP 3) in the hand-rolled scroller: closing the viewer must
  // land on the same tile here as in the virtualized views.
  useEffect(() => {
    if (revealId == null) return;
    const y = positionOf.get(revealId);
    if (y != null) {
      scroller.current?.scrollTo({ top: Math.max(0, y - 140), behavior: "smooth" });
    }
    onRevealed?.();
  }, [revealId, positionOf, onRevealed]);

  const columnWidth = packed.colW;
  const tiles: { media: MediaRow; x: number; y: number; h: number }[] = [];
  packed.columns.forEach((col, c) => {
    const x = c * (columnWidth + gap);
    col.items.forEach((itemIndex, k) => {
      const y = col.offsets[k];
      const h = col.heights[k];
      if (y + h < view.top - pad || y > view.bottom + pad) return;
      tiles.push({ media: visibleRows[itemIndex], x, y, h });
    });
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* F6: the "first 2,000" mono band is gone — a dev-limit banner is not a
          UI element. The cap stays (perf), the apology doesn't. */}
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
                onActivate={() => onActivate(media.id)}
                onPressStart={onPressStart ? () => onPressStart(media.id) : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
