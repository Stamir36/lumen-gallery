import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Check, Heart, Play, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { fileSrc } from "@/lib/assets";
import { enqueueRows } from "@/lib/thumbs";
import { baseName, formatDuration, formatResolution } from "@/lib/format";
import { MonoChip } from "@/components/ui/Chip";
import { ThumbTile } from "./ThumbTile";

/** Card hover contract (SPEC §4): inner scale 1.03, gradient, mono chips,
 *  heart on hover; videos scrub-preview after 400ms and reset on leave. */

const SCRUB_DELAY_MS = 400;
/** Only ONE card scrubs at a time — a second hover stops the first. */
let stopActiveScrub: (() => void) | null = null;

export interface MediaCardProps {
  media: MediaRow;
  radius?: number;
  focused?: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onActivate?: (media: MediaRow) => void;
}

export const MediaCard = memo(function MediaCard({
  media,
  radius = 12,
  focused = false,
  selectionMode,
  selected,
  onToggleSelect,
  onActivate,
}: MediaCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const isVideo = media.kind === "video";
  const [preview, setPreview] = useState(false);
  const [scrubFailed, setScrubFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // thumbs are lazy: only cards that actually mounted in the viewport ask
  useEffect(() => {
    enqueueRows([media]);
  }, [media]);

  const stopPreview = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (stopActiveScrub === stopPreview) stopActiveScrub = null;
    setPreview(false);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (stopActiveScrub === stopPreview) stopActiveScrub = null;
    },
    [stopPreview],
  );

  const onEnter = () => {
    // prefers-reduced-motion: no auto-playing motion inside the grid
    if (!isVideo || scrubFailed || reduced || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      stopActiveScrub?.();
      stopActiveScrub = stopPreview;
      setPreview(true);
    }, SCRUB_DELAY_MS);
  };

  const duration = isVideo ? formatDuration(media.durationMs) : null;
  const resolution = isVideo ? null : formatResolution(media.width, media.height);
  const name = baseName(media.path);

  return (
    <div
      className={cn("group relative h-full w-full select-none", media.offline && "opacity-80")}
      onPointerEnter={onEnter}
      onPointerLeave={stopPreview}
    >
      <button
        type="button"
        title={name}
        aria-label={media.offline ? `${name} — ${t("offline.chip")}` : name}
        onClick={() => (selectionMode ? onToggleSelect(media.id) : onActivate?.(media))}
        className={cn(
          "absolute inset-0 overflow-hidden transition-[transform,box-shadow] duration-[160ms] ease-out",
          "hover:-translate-y-0.5 hover:z-10",
          "hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.18)]",
          "active:scale-[.97]",
          selected && "ring-2 ring-accent/60",
          focused && "ring-2 ring-accent/40 ring-offset-2 ring-offset-canvas",
        )}
        style={{ borderRadius: radius }}
      >
        {media.offline ? (
          /* ejected root: gray tile + mono offline chip, never a broken image */
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 px-3 text-ttertiary">
            <Unplug size={20} />
            <span className="max-w-full truncate font-mono text-[10px] tracking-[0.06em]">
              {name}
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 transition-transform duration-[160ms] ease-out group-hover:scale-[1.03]">
            <ThumbTile media={media} />
          </div>
        )}

        {/* bottom gradient + mono metadata chips (hover only, per v2.2) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/25 to-transparent opacity-0 transition-opacity duration-[160ms] ease-out group-hover:opacity-100" />
        {!media.offline && (duration || resolution) && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex translate-y-1 items-center gap-1.5 opacity-0 transition-all duration-[160ms] ease-out group-hover:translate-y-0 group-hover:opacity-100">
            {duration && <MonoChip>{duration}</MonoChip>}
            {resolution && <MonoChip>{resolution}</MonoChip>}
          </div>
        )}

        {isVideo && !media.offline && (
          <span
            className={cn(
              "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white transition-opacity duration-[160ms]",
              preview ? "opacity-0" : "opacity-40",
            )}
          >
            <Play size={40} fill="currentColor" strokeWidth={0} />
          </span>
        )}

        <AnimatePresence>
          {preview && (
            <motion.video
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              ref={(el) => {
                if (el) {
                  videoRef.current = el;
                } else if (videoRef.current) {
                  // leave/reset: never keep a decoder running off-screen
                  videoRef.current.pause();
                  videoRef.current.removeAttribute("src");
                  videoRef.current.load();
                  videoRef.current = null;
                }
              }}
              src={fileSrc(media.path)}
              muted
              loop
              playsInline
              autoPlay
              className="absolute inset-0 h-full w-full object-cover"
              onLoadedData={(e) => {
                e.currentTarget.playbackRate = 6;
                void e.currentTarget.play().catch(() => undefined);
              }}
              onError={() => {
                setScrubFailed(true);
                stopPreview();
              }}
            />
          )}
        </AnimatePresence>
      </button>

      {/* offline marker stays visible without hover (contract from scan.rs) */}
      {media.offline && (
        <span className="pointer-events-none absolute bottom-2 left-2 z-10">
          <MonoChip>{t("offline.chip")}</MonoChip>
        </span>
      )}

      {/* heart + selection: hover reveals, favorite/selection pin */}
      <div
        className={cn(
          "absolute right-2 top-2 z-20 flex items-center gap-1.5 transition-opacity duration-[160ms]",
          "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          media.favorite && "opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={media.favorite ? t("actions.unfavorite") : t("actions.favorite")}
          aria-pressed={media.favorite}
          className="flex h-8 w-8 items-center justify-center rounded-pill bg-black/45 text-tsecondary transition-colors duration-[160ms] hover:bg-black/70 hover:text-tprimary"
          onClick={(e) => {
            e.stopPropagation();
            void import("@/lib/mediaActions").then((m) => m.toggleFavorite(media.id));
          }}
        >
          <Heart
            size={15}
            fill={media.favorite ? "currentColor" : "none"}
            className={media.favorite ? "text-tprimary" : undefined}
          />
        </button>
      </div>

      <button
        type="button"
        aria-label={selected ? t("actions.deselect") : t("actions.select")}
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(media.id);
        }}
        className={cn(
          "absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-[9px] border transition-opacity duration-[160ms]",
          selected
            ? "border-accent bg-accent text-[#0A0A0C] opacity-100"
            : "border-white/40 bg-black/40 text-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          selectionMode && "opacity-100",
        )}
      >
        <Check size={15} strokeWidth={3} />
      </button>
    </div>
  );
});
