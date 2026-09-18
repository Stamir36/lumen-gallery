import { useEffect, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { ThumbTile } from "@/components/library/ThumbTile";
import { useViewer } from "@/state/viewer";

/** horizontal tiles: 1.6:1, vertical rail: 16:9 full-width (FIX 2) */
const H_TILE = { w: 108, h: 68 };
const V_TILE = { w: 128, h: 72 };

/**
 * The viewer queue as a VIRTUALIZED strip (STEP 1 / STEP 2): a 9 390-item queue
 * must not mount 9 390 thumbnails. Horizontal under the lightbox, vertical as the
 * player's "up next" rail — same component, same current-item highlight, click to
 * jump. Thumbnails come from the shared thumb store, so a strip tile is warm if
 * the grid already generated it.
 *
 * Interaction: the wheel walks the strip in BOTH orientations (a vertical wheel
 * over a horizontal strip is what everyone tries first), the current tile is
 * marked with an accent ring and lifted, neighbours stay dimmed until hovered so
 * the eye lands on the active frame, and videos carry a mono duration chip.
 */
export function Filmstrip({
  vertical = false,
  height = 96,
  className,
}: {
  vertical?: boolean;
  /** content height of the horizontal strip (the rail ignores it) */
  height?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);
  const setIndex = useViewer((s) => s.setIndex);
  const ref = useRef<VirtuosoHandle>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const last = useRef(index);

  const tile = vertical ? V_TILE : { ...H_TILE, h: height };
  const tileH = tile.h;

  // keep the current item in view when navigation happens from arrows/keys
  useEffect(() => {
    if (last.current === index) return;
    last.current = index;
    ref.current?.scrollIntoView({ index, behavior: "smooth" });
  }, [index]);

  // Wheel = walk the strip. Attached natively and NON-passive: React's onWheel
  // is passive, so preventDefault there is ignored and the gesture would scroll
  // the page (or the grid) behind the viewer instead of the strip.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const before = vertical ? el.scrollTop : el.scrollLeft;
      const max = vertical
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(max, before + delta));
      if (next === before && (before === 0 || before === max)) return;
      e.preventDefault();
      if (vertical) el.scrollTop = next;
      else el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vertical, queue.length]);

  if (queue.length === 0) return null;

  return (
    <Virtuoso
      ref={ref}
      data={queue}
      horizontalDirection={!vertical}
      scrollerRef={(el) => {
        scroller.current = el instanceof HTMLElement ? el : null;
      }}
      style={
        vertical
          ? { height: "100%", width: V_TILE.w }
          : { height: tileH, width: "100%" }
      }
      initialTopMostItemIndex={Math.max(0, index - 2)}
      increaseViewportBy={800}
      className={cn("no-scrollbar", className)}
      itemContent={(i, row) => {
        const active = i === index;
        return (
          <button
            type="button"
            onClick={() => setIndex(i)}
            onDoubleClick={() => useViewer.getState().close()}
            aria-label={row.path.split(/[\\/]/).pop() ?? row.path}
            aria-current={active}
            className={cn(
              "group relative rounded-[8px] outline-none transition-all duration-[160ms] ease-out",
              // 4px each side = an 8px gap between tiles (FIX 2)
              vertical ? "my-1" : "mx-1",
              active
                ? "scale-[1.03] ring-2 ring-accent shadow-[0_8px_24px_rgba(0,0,0,.45)]"
                : "opacity-75 hover:opacity-100 hover:scale-[1.02] focus-visible:opacity-100",
            )}
            style={{ width: tile.w, height: tileH }}
          >
            <span className="absolute inset-0 overflow-hidden rounded-[8px] bg-surface-2">
              <ThumbTile media={row} shimmer={false} />
              {/* video affordance: dim + glyph, duration chip bottom-right */}
              {row.kind === "video" && (
                <>
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/85">
                    <Play size={16} fill="currentColor" strokeWidth={0} />
                  </span>
                  <span className="pointer-events-none absolute bottom-1 right-1 rounded-[6px] bg-black/65 px-1 py-px font-mono text-[9px] tabular-nums text-white/90 backdrop-blur-sm">
                    {formatDuration(row.durationMs) ?? t("viewer.video")}
                  </span>
                </>
              )}
            </span>
          </button>
        );
      }}
    />
  );
}
