import { memo, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { useThumbStore } from "@/lib/thumbs";

/**
 * Thumbnail tile: dominant-color placeholder underneath, cached thumb fading
 * in over 180ms on top (no pop-in), shimmer only while the thumb is missing.
 *
 * Reads BOTH the cached DB path and the live thumb store, so a thumb generated
 * lazily while the grid is open shows up without a refetch.
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
  const state = useThumbStore((s) => s.thumbs[media.id]);
  const src = state?.path ?? media.thumbPath ?? null;
  const color = state?.color ?? media.dominantColor ?? null;
  const [loaded, setLoaded] = useState(false);

  // a new src (freshly generated thumb) must fade again
  useEffect(() => setLoaded(false), [src]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-surface-2", className)}
      style={color ? { backgroundColor: color } : undefined}
    >
      {shimmer && !src && state?.status !== "error" && (
        <div className="shimmer-bg absolute inset-0" />
      )}
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-[180ms] ease-out",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : (
        state?.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-ttertiary">
            <ImageOff size={22} />
          </div>
        )
      )}
    </div>
  );
});
