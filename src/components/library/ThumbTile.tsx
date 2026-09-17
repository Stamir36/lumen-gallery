import { memo, useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MediaRow } from "@/lib/api";
import { enqueueRows, thumbSrc, useThumbStore } from "@/lib/thumbs";

/**
 * Thumbnail tile: dominant-color placeholder underneath, cached thumb fading
 * in over 180ms on top (no pop-in), shimmer only while the thumb is pending.
 *
 * Failure contract (FIX 2):
 *  - Rust decode failed (thumb_error) → try the WebView decoder ONCE via
 *    createImageBitmap (it handles formats the Rust image crate does not:
 *    HEIC via platform codecs, exotic WebP/AVIF profiles…);
 *  - that failed too → neutral surface + mono ext chip, NEVER a broken-image
 *    glyph, no retry loops (rare races retry at most once after 5s);
 *  - a missing thumb FILE (cache wiped) forgets the row so it regenerates.
 */

const FALLBACK_KEY = "thumbFallbackTried";

/** Builds a data: URL from the media file bytes through the fs plugin. */
async function fileDataUrl(path: string): Promise<string | null> {
  try {
    // the fs plugin read is capability-scoped to media roots + thumbs cache
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(path);
    // sniff a content type: Rust said "undetermined", guess from magic bytes
    const type = sniffType(bytes);
    const blob = new Blob([bytes], { type });
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function sniffType(b: Uint8Array): string {
  if (b.length > 11 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 12 && b[8] === 0x66 && b[9] === 0x74 && b[10] === 0x79 && b[11] === 0x70)
    return "image/avif"; // ISOBMFF ftyp — avif/heif family
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45)
    return "image/webp"; // RIFF….WEBP
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b.length > 2 && b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b.length > 4 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return "application/octet-stream";
}

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
  /** WebView-decoded data: URL when Rust could not decode the file */
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const fallbackBusy = useRef(false);

  const failed = (state?.status === "error" || (!state && media.thumbError)) && !fallbackSrc;

  useEffect(() => setLoaded(false), [src, fallbackSrc]);

  // Rust-side permanent failure: give the WebView decoder exactly one chance
  useEffect(() => {
    if (!media.thumbError || fallbackSrc || fallbackBusy.current) return;
    if (media.kind !== "image") return; // videos keep their own rest-state
    if (localStorage.getItem(`${FALLBACK_KEY}:${media.id}`)) return;
    fallbackBusy.current = true;
    void (async () => {
      const url = await fileDataUrl(media.path);
      localStorage.setItem(`${FALLBACK_KEY}:${media.id}`, "1"); // once, ever
      if (url) {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob()).catch(
          () => null,
        );
        if (bitmap) {
          setFallbackSrc(url);
          bitmap.close();
        }
      }
      fallbackBusy.current = false;
    })();
  }, [media.thumbError, media.path, media.id, fallbackSrc]);

  const shown = src ?? fallbackSrc;

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-surface-2", className)}
      style={color ? { backgroundColor: color } : undefined}
    >
      {shimmer && !shown && !failed && <div className="shimmer-bg absolute inset-0" />}
      {shown && !failed ? (
        <img
          src={shown}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            // A missing thumbnail FILE (cache wiped / stale path) is NOT a decode
            // failure: forget the row so it can be regenerated. Decode failures
            // arrive as thumbError from Rust, so this retries at most twice.
            if (shown === fallbackSrc) {
              useThumbStore.getState().set(media.id, { status: "error", noPreview: true });
              return;
            }
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
      ) : (
        failed && (
          // neutral surface: ext chip + subtle icon — design language, no broken glyph
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
        )
      )}
    </div>
  );
});
