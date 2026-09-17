import { memo, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { thumbSrc, useThumbStore } from "@/lib/thumbs";

/**
 * Thumbnail tile: dominant-color placeholder underneath, cached thumb fading
 * in over 180ms on top (no pop-in), shimmer only while the thumb is pending.
 *
 * Two hard rules learned from a real 9,390-item library:
 *  1. `thumb_path` is a FILESYSTEM path — it must go through convertFileSrc
 *     (`thumbSrc`) or the webview tries to load `C:\...` and silently shows the
 *     placeholder forever.
 *  2. When a file is undecodable (corrupt / mislabeled extension) the tile must
 *     say so in design language (mono ext chip + muted glyph), never show a
 *     broken-image glyph and never retry.
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
  const rawPath = state?.path ?? media.thumbPath ?? null;
  const src = rawPath ? thumbSrc(rawPath) : null;
  const color = state?.color ?? media.dominantColor ?? null;
  const [loaded, setLoaded] = useState(false);

  const failed = state?.status === "error" || (!state && media.thumbError);

  // a new src (freshly generated thumb) must fade again
  useEffect(() => setLoaded(false), [src]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-surface-2", className)}
      style={color ? { backgroundColor: color } : undefined}
    >
      {shimmer && !src && !failed && <div className="shimmer-bg absolute inset-0" />}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() =>
            // the file exists but the webview cannot decode it: same contract as
            // a Rust decode failure — placeholder + label, no retry loop
            useThumbStore.getState().set(media.id, { status: "error", noPreview: true })
          }
          className={cn(
            "h-full w-full object-cover transition-opacity duration-[180ms] ease-out",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : (
        failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-ttertiary">
            {media.kind === "image" && <ImageOff size={20} />}
            <span className="flex items-center gap-1.5">
              <span className="rounded-[6px] border border-white/12 bg-black/35 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]">
                {media.ext}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
                {t("thumbs.noPreview")}
              </span>
            </span>
          </div>
        )
      )}
    </div>
  );
});
