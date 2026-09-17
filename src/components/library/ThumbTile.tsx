import { memo, useEffect, useState } from "react";
import { FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import {
  enqueueRows,
  ensureBrowserThumb,
  thumbSrc,
  useThumbStore,
} from "@/lib/thumbs";

/**
 * Thumbnail tile: a dominant-color placeholder underneath, the cached thumb
 * fading in over 180ms on top (no pop-in), shimmer only while the thumb is
 * genuinely pending.
 *
 * State contract (S1.6): shimmer → thumb → neutral tile + mono ext chip.
 *
 * Failure chain:
 *  - Rust decode failed → the WebView decoder gets ONE PERSISTED try (S1.5,
 *    `ensureBrowserThumb`) — it handles HEIC/AVIF/exotic WebP profiles the Rust
 *    image crate does not;
 *  - that failed too → neutral surface + mono ext chip: images show a subtle
 *    icon, videos keep their play glyph so a frame-less video still reads as a
 *    video. NEVER a broken-image glyph, never an error patch on a file that the
 *    WebView can open;
 *  - a missing thumb FILE (cache wiped / stale path) forgets the row so it can
 *    regenerate, instead of sticking as "no preview".
 */
export const ThumbTile = memo(function ThumbTile({
  media,
  className,
  imgClassName,
  shimmer = true,
}: {
  media: MediaRow;
  className?: string;
  imgClassName?: string;
  shimmer?: boolean;
}) {
  const { t } = useTranslation();
  const state = useThumbStore((s) => s.thumbs[media.id]);
  // warm rows carry their path in the DB row itself (S1.1) — the store entry
  // wins once a fresh thumbnail exists for this session
  const rawPath = state?.path ?? media.thumbPath ?? null;
  const src = rawPath ? thumbSrc(rawPath) : null;
  const color = state?.color ?? media.dominantColor ?? null;
  const [loaded, setLoaded] = useState(false);

  const status = state?.status;
  const isVideo = media.kind === "video";
  /** every decoder failed for THIS file version — render the neutral tile */
  const noPreview = state?.noPreview ?? (!state && media.thumbError);
  const failed = status === "error" && noPreview;

  useEffect(() => setLoaded(false), [src]);

  // Rust said "undetermined format": give the WebView decoder one persisted
  // chance (it can write the frame into the cache, so this never runs twice for
  // the same file version).
  useEffect(() => {
    if (!noPreview || isVideo) return;
    void ensureBrowserThumb(media);
  }, [noPreview, isVideo, media]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-surface-2", className)}
      style={color ? { backgroundColor: color } : undefined}
    >
      {/* shimmer ONLY while a thumbnail is genuinely being generated for this
          row: a tile that was never enqueued should look like a quiet surface,
          not like work in progress */}
      {shimmer && !src && !failed && (status === "pending" || !state) && (
        <div className="shimmer-bg absolute inset-0" />
      )}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            // A missing thumbnail FILE (cache wiped / stale path) is NOT a decode
            // failure: forget the row so it can be regenerated. Decode failures
            // arrive as thumbError from Rust, so this retries at most twice.
            const store = useThumbStore.getState();
            if ((store.attempts[media.id] ?? 0) >= 2) {
              store.set(media.id, { status: "error", noPreview: true });
            } else {
              store.forget(media.id);
              enqueueRows([media]);
            }
          }}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-[180ms] ease-out",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : failed && !isVideo ? (
        // neutral surface: mono ext chip + subtle icon — design language, no
        // broken-image glyph. Videos deliberately keep the play glyph only.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-ttertiary">
          <FileWarning size={18} strokeWidth={1.5} />
          <span className="flex items-center gap-1.5">
            <span className="rounded-[6px] border border-white/12 bg-black/35 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]">
              {media.ext}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
              {t("thumbs.noPreview")}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
});
