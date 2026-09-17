import { useEffect, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { ThumbTile } from "@/components/library/ThumbTile";
import { useViewer } from "@/state/viewer";

const TILE = 88;
const GAP = 8;
const BAR = TILE + GAP * 2;

/**
 * The viewer queue as a VIRTUALIZED strip (STEP 1 / STEP 2): a 9 390-item queue
 * must not mount 9 390 thumbnails. Horizontal under the lightbox, vertical as the
 * player's "up next" rail — same component, same current-item highlight, click to
 * jump. Thumbnails come from the shared thumb store, so a strip tile is warm if
 * the grid already generated it.
 */
export function Filmstrip({ vertical = false }: { vertical?: boolean }) {
  const { t } = useTranslation();
  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);
  const setIndex = useViewer((s) => s.setIndex);
  const ref = useRef<VirtuosoHandle>(null);
  const last = useRef(index);

  // keep the current item in view when navigation happens from the arrows/keys
  useEffect(() => {
    if (last.current === index) return;
    last.current = index;
    ref.current?.scrollIntoView({ index, behavior: "smooth" });
  }, [index]);

  if (queue.length === 0) return null;

  return (
    <Virtuoso
      ref={ref}
      data={queue}
      horizontalDirection={!vertical}
      style={vertical ? { height: "100%", width: BAR } : { height: BAR, width: "100%" }}
      initialTopMostItemIndex={Math.max(0, index - 2)}
      increaseViewportBy={800}
      itemContent={(i, row) => (
        <button
          type="button"
          onClick={() => setIndex(i)}
          aria-label={row.path.split(/[\\/]/).pop() ?? row.path}
          aria-current={i === index}
          className={cn(
            "group relative overflow-hidden rounded-[12px] transition-transform duration-[160ms] ease-out",
            vertical ? "my-1" : "mx-1",
            i === index
              ? "ring-2 ring-accent"
              : "opacity-70 hover:opacity-100 hover:-translate-y-0.5",
          )}
          style={{ width: TILE, height: TILE / 1.6, borderRadius: 12 }}
        >
          <ThumbTile media={row} shimmer={false} />
          {row.kind === "video" && (
            <>
              <span className="pointer-events-none absolute inset-0 bg-black/20" />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/80">
                <Play size={18} fill="currentColor" strokeWidth={0} />
              </span>
              <span className="pointer-events-none absolute bottom-1 right-1 rounded-[6px] bg-black/60 px-1 font-mono text-[9px] text-white/85">
                {formatDuration(row.durationMs) ?? t("viewer.video")}
              </span>
            </>
          )}
        </button>
      )}
    />
  );
}
