import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Check,
  Clipboard,
  Eye,
  FolderOpen,
  Heart,
  Play,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  Unplug,
} from "lucide-react";
import { useContextMenu } from "@/state/contextMenu";
import { tauriAvailable } from "@/lib/assets";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { fileSrc } from "@/lib/assets";
import { enqueueRows } from "@/lib/thumbs";
import { useAppSettings } from "@/lib/settings";
import { baseName, formatDuration, formatResolution } from "@/lib/format";
import { MonoChip } from "@/components/ui/Chip";
import { ThumbTile } from "./ThumbTile";

/** Card hover contract (SPEC §4): inner scale 1.03, gradient, mono chips,
 *  heart on hover; videos scrub-preview after 400ms and reset on leave. */

const SCRUB_DELAY_MS = 400;
/** Only ONE card scrubs at a time — a second hover stops the first. */
let stopActiveScrub: (() => void) | null = null;

/**
 * Called when a viewer or the collage opens: a hover preview looping behind a
 * fullscreen overlay is a decoder burning CPU for nobody (and on a big library
 * that is exactly the kind of background load that makes the UI feel frozen).
 */
export function stopCardPreviews() {
  stopActiveScrub?.();
}

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
  const scrubRate = useAppSettings((s) => s.videoScrubRate);
  // Settings › Appearance: filename caption over the hover gradient (F2)
  const hoverCaptions = useAppSettings((s) => s.hoverCaptions);
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
  const openMenu = useContextMenu((s) => s.openMenu);

  /**
   * Right-click menu (FIX 8): the card describes its own actions, the host
   * renders them. Everything here is one gesture away instead of two screens.
   */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({
      x: e.clientX,
      y: e.clientY,
      title: name,
      mono: resolution ?? duration ?? media.ext.toUpperCase(),
      sections: [
        {
          id: "open",
          items: [
            {
              id: "open",
              label: t("menu.open"),
              icon: <Eye size={15} />,
              onSelect: () => onActivate?.(media),
            },
          ],
        },
        {
          id: "actions",
          items: [
            {
              id: "fav",
              label: media.favorite ? t("menu.unfavorite") : t("menu.favorite"),
              icon: <Star size={15} />,
              onSelect: () =>
                void import("@/lib/mediaActions").then((m) => m.toggleFavorite(media.id)),
            },
            {
              id: "select",
              label: selected ? t("menu.deselect") : t("menu.select"),
              icon: <Check size={15} />,
              onSelect: () => onToggleSelect(media.id),
            },
          ],
        },
        {
          id: "system",
          items: [
            {
              id: "copy",
              label: t("menu.copy_path"),
              icon: <Clipboard size={15} />,
              hint: media.ext.toUpperCase(),
              onSelect: () => {
                void navigator.clipboard
                  .writeText(media.path)
                  .then(() => toast.success(t("menu.copied")))
                  .catch(() => toast.error(t("menu.copy_failed")));
              },
            },
            {
              id: "folder",
              label: t("menu.open_folder"),
              icon: <FolderOpen size={15} />,
              disabled: !tauriAvailable(),
              onSelect: () => {
                // BUG: this used to call open_external with the DIRECTORY, and
                // open_external hands any path to the configured external
                // player — so "open the file's folder" launched that player.
                // reveal_path /select's the FILE in Explorer instead.
                void invoke("reveal_path", { path: media.path }).catch((err) =>
                  toast.error(String(err)),
                );
              },
            },
            {
              id: "external_player",
              label: t("menu.open_external"),
              icon: <SquareArrowOutUpRight size={15} />,
              disabled: !tauriAvailable(),
              onSelect: () => {
                void invoke("open_external", { path: media.path }).catch((err) =>
                  toast.error(String(err)),
                );
              },
            },
          ],
        },
        {
          id: "danger",
          items: [
            {
              id: "trash",
              label: t("menu.trash"),
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () => {
                void import("@/lib/mediaActions").then((m) => m.trashMedia([media.id]));
              },
            },
          ],
        },
      ],
    });
  };

  return (
    <div
      className={cn("group relative h-full w-full select-none", media.offline && "opacity-80")}
      onPointerEnter={onEnter}
      onPointerLeave={stopPreview}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        title={name}
        aria-label={media.offline ? `${name} — ${t("offline.chip")}` : name}
        onClick={() => (selectionMode ? onToggleSelect(media.id) : onActivate?.(media))}
        className={cn(
          "absolute inset-0 overflow-hidden transition-[transform,box-shadow] duration-[160ms] ease-out",
          "hover:-translate-y-0.5 hover:z-10",
          "hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_var(--accent-soft)]",
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
          <div
            className={cn(
              "pointer-events-none absolute inset-x-2 z-10 flex translate-y-1 items-center gap-1.5 opacity-0 transition-all duration-[160ms] ease-out group-hover:translate-y-0 group-hover:opacity-100",
              // the caption owns the last line, so the chips step up when it shows
              hoverCaptions ? "bottom-8" : "bottom-2",
            )}
          >
            {duration && <MonoChip>{duration}</MonoChip>}
            {resolution && <MonoChip>{resolution}</MonoChip>}
          </div>
        )}

        {/* filename caption (F2) — body size, secondary, over the gradient */}
        {hoverCaptions && !media.offline && (
          // text-left is load-bearing: a <button> centres its text by default,
          // which is why the caption looked centred. Brighter + medium weight
          // so it stays readable over the gradient.
          <span
            className="pointer-events-none absolute inset-x-3 bottom-2.5 z-10 truncate text-left text-[12.5px] font-medium leading-tight text-white opacity-0 transition-opacity duration-[160ms] ease-out group-hover:opacity-100"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,.7)" }}
          >
            {name}
          </span>
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
                // user setting (Settings › Playback): 6× felt like fast-forward
                e.currentTarget.playbackRate = scrubRate;
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

      {/* excluded folder (FIX 5): these rows only reach the grid when
          "show excluded" is on, so the chip explains why they are here */}
      {media.excluded && (
        <span className="pointer-events-none absolute bottom-2 right-2 z-10">
          <MonoChip>{t("menu.folder_excluded_chip")}</MonoChip>
        </span>
      )}

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
          <motion.span
            key={String(media.favorite)}
            animate={
              // F6: 240ms scale burst the moment it turns favorite
              !reduced && media.favorite ? { scale: [1, 1.35, 1] } : { scale: 1 }
            }
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="inline-flex"
          >
            <Heart
              size={15}
              fill={media.favorite ? "currentColor" : "none"}
              className={media.favorite ? "text-accent" : undefined}
            />
          </motion.span>
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
        <motion.span
          animate={selected ? { scale: [0.5, 1.15, 1] } : { scale: 1 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="inline-flex"
        >
          <Check size={15} strokeWidth={3} />
        </motion.span>
      </button>
    </div>
  );
});
