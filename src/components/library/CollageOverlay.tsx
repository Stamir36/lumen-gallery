import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Pause, Play, Rows3, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { fileSrc } from "@/lib/assets";
import { thumbSrc } from "@/lib/thumbs";

/**
 * Collage multi-viewer (FIX 4): a fullscreen composition of the selected items,
 * NOT a grid mode. Layout presets follow the selection count, the glass chip
 * cycles alternatives, Esc closes. Tiles keep the viewer contract free: the
 * click handler is the Phase 4 hook (click = play/pause for video today).
 */

interface Layout {
  cols: string;
  rows: string;
  tiles: { gridColumn: string; gridRow: string }[];
}

const AREA = (c: string, r: string) => ({ gridColumn: c, gridRow: r });

function layoutsFor(count: number): Layout[] {
  switch (count) {
    case 2:
      return [
        {
          cols: "1fr 1fr",
          rows: "1fr",
          tiles: [AREA("1 / 2", "1 / 2"), AREA("2 / 3", "1 / 2")],
        },
        {
          cols: "1fr",
          rows: "1fr 1fr",
          tiles: [AREA("1 / 2", "1 / 2"), AREA("1 / 2", "2 / 3")],
        },
      ];
    case 3:
      return [
        {
          cols: "2fr 1fr",
          rows: "1fr 1fr",
          tiles: [AREA("1 / 2", "1 / 3"), AREA("2 / 3", "1 / 2"), AREA("2 / 3", "2 / 3")],
        },
        {
          cols: "1fr 2fr",
          rows: "1fr 1fr",
          tiles: [AREA("2 / 3", "1 / 3"), AREA("1 / 2", "1 / 2"), AREA("1 / 2", "2 / 3")],
        },
      ];
    case 4:
      return [
        {
          cols: "1fr 1fr",
          rows: "1fr 1fr",
          tiles: [
            AREA("1 / 2", "1 / 2"),
            AREA("2 / 3", "1 / 2"),
            AREA("1 / 2", "2 / 3"),
            AREA("2 / 3", "2 / 3"),
          ],
        },
        {
          cols: "2fr 1fr 1fr",
          rows: "1fr 1fr",
          tiles: [
            AREA("1 / 2", "1 / 3"),
            AREA("2 / 3", "1 / 2"),
            AREA("2 / 3", "2 / 3"),
            AREA("3 / 4", "1 / 3"),
          ],
        },
      ];
    case 5:
      return [
        {
          cols: "repeat(6, 1fr)",
          rows: "1fr 1fr",
          tiles: [
            AREA("1 / 4", "1 / 2"),
            AREA("4 / 7", "1 / 2"),
            AREA("1 / 3", "2 / 3"),
            AREA("3 / 5", "2 / 3"),
            AREA("5 / 7", "2 / 3"),
          ],
        },
        {
          cols: "repeat(8, 1fr)",
          rows: "1.5fr 1fr",
          tiles: [
            AREA("1 / 9", "1 / 2"),
            AREA("1 / 3", "2 / 3"),
            AREA("3 / 5", "2 / 3"),
            AREA("5 / 7", "2 / 3"),
            AREA("7 / 9", "2 / 3"),
          ],
        },
      ];
    case 6:
    default:
      return [
        {
          cols: "repeat(6, 1fr)",
          rows: "1fr 1fr",
          tiles: [
            AREA("1 / 3", "1 / 2"),
            AREA("3 / 5", "1 / 2"),
            AREA("5 / 7", "1 / 2"),
            AREA("1 / 3", "2 / 3"),
            AREA("3 / 5", "2 / 3"),
            AREA("5 / 7", "2 / 3"),
          ],
        },
        {
          cols: "repeat(4, 1fr)",
          rows: "repeat(3, 1fr)",
          tiles: [
            AREA("1 / 3", "1 / 2"),
            AREA("3 / 5", "1 / 2"),
            AREA("1 / 3", "2 / 3"),
            AREA("3 / 5", "2 / 3"),
            AREA("1 / 3", "3 / 4"),
            AREA("3 / 5", "3 / 4"),
          ],
        },
      ];
  }
}

export function CollageOverlay({ rows, onClose }: { rows: MediaRow[]; onClose: () => void }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [variant, setVariant] = useState(0);

  const layouts = useMemo(() => layoutsFor(rows.length), [rows.length]);
  const layout = layouts[variant % layouts.length];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("collage.title")}
      className="fixed inset-0 z-50 flex bg-black/96 p-6"
    >
      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{ gap: 12, gridTemplateColumns: layout.cols, gridTemplateRows: layout.rows }}
      >
        {rows.slice(0, layout.tiles.length).map((row, i) => (
          <CollageTile key={row.id} row={row} area={layout.tiles[i]} />
        ))}
      </div>

      {/* floating glass chips — whitelisted (v2.2) */}
      <div className="absolute right-6 top-6 z-10 flex items-center gap-2">
        {layouts.length > 1 && (
          <button
            type="button"
            onClick={() => setVariant((v) => (v + 1) % layouts.length)}
            title={t("collage.cycle")}
            aria-label={t("collage.cycle")}
            className="glass flex h-10 items-center gap-2 rounded-pill px-4 text-sm text-tprimary transition-transform duration-[160ms] active:scale-[.97]"
          >
            <Rows3 size={16} />
            {t("collage.cycle")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title={t("collage.close")}
          aria-label={t("collage.close")}
          className="glass flex h-10 w-10 items-center justify-center rounded-pill text-tprimary transition-transform duration-[160ms] active:scale-[.97]"
        >
          <X size={18} />
        </button>
      </div>

      <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tracking-[0.06em] text-ttertiary">
        {t("collage.hint")}
      </span>
    </motion.div>
  );
}

function CollageTile({
  row,
  area,
}: {
  row: MediaRow;
  area: { gridColumn: string; gridRow: string };
}) {
  const { t } = useTranslation();
  const isVideo = row.kind === "video";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const thumb = row.thumbPath ? thumbSrc(row.thumbPath) : null;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  return (
    <div
      className="group relative min-h-0 min-w-0 overflow-hidden rounded-2xl bg-surface-1"
      style={{ ...area, backgroundColor: row.dominantColor ?? undefined }}
      // click reserves the Phase 4 viewer hook; for video it is play/pause today
      onClick={isVideo ? togglePlay : undefined}
      data-viewer-hook={row.id}
    >
      {/* placeholder: cached 480w thumb, scaled → blur-free enough at tile size */}
      {thumb && (
        <img
          src={thumb}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}

      {isVideo ? (
        <video
          ref={videoRef}
          src={fileSrc(row.path)}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className={cn(
            "absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-[160ms]",
            playing ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <img
          src={fileSrc(row.path)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}

      {!thumb && !row.path && (
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-ttertiary">
          {t("thumbs.noPreview")}
        </span>
      )}

      {isVideo && (
        <div
          className={cn(
            "glass absolute bottom-3 right-3 flex items-center gap-1 rounded-pill p-1",
            "transition-opacity duration-[160ms]",
            playing ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            aria-label={playing ? t("collage.pause") : t("collage.play")}
            title={playing ? t("collage.pause") : t("collage.play")}
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-pill text-tprimary transition-colors hover:bg-white/[.10]"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            aria-label={muted ? t("collage.unmute") : t("collage.mute")}
            title={muted ? t("collage.unmute") : t("collage.mute")}
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-pill text-tprimary transition-colors hover:bg-white/[.10]"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}
