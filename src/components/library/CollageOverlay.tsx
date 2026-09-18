import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Pause, Play, Rows3, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaUrl, type MediaRow } from "@/lib/api";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { thumbSrc } from "@/lib/thumbs";
import { useViewer } from "@/state/viewer";

/** mono timecode for the tile scrubber ("1:04") */
function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${h > 0 ? `${h}:` : ""}${h > 0 ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}

/** C2: hex → darkened hex (amount 0..1), falling back to the raw value. */
function darkenHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * (1 - amount)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

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
          <CollageTile
            key={row.id}
            row={row}
            area={layout.tiles[i]}
            // double-click a tile: hand the whole collage to the full viewer,
            // which then keeps walking the same queue
            onOpen={() => {
              onClose();
              useViewer.getState().openAt(rows, i);
            }}
          />
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

      {/* the hint sits LEFT (bottom-left, mono) — nothing is centred here */}
      <span className="pointer-events-none absolute bottom-2.5 left-6 max-w-[52vw] truncate whitespace-nowrap font-mono text-[10.5px] tracking-[0.06em] text-ttertiary">
        {t("collage.hint")}
      </span>
    </motion.div>
  );
}

function CollageTile({
  row,
  area,
  onOpen,
}: {
  row: MediaRow;
  area: { gridColumn: string; gridRow: string };
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const isVideo = row.kind === "video";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [shown, setShown] = useState(0);
  const [total, setTotal] = useState((row.durationMs ?? 0) / 1000);
  const [buffered, setBuffered] = useState(0);
  const [barHover, setBarHover] = useState(false);
  const thumb = row.thumbPath ? thumbSrc(row.thumbPath) : null;
  const progress = total > 0 ? Math.min(1, shown / total) : 0;

  // P7 F3: resolve the loopback media_url once per tile (videos only).
  // crossOrigin + ACAO:* keeps the frames CORS-clean so a tile handed to the
  // full viewer can snapshot immediately; asset:// fallback keeps playback
  // alive if the server is down. Images stay on the asset protocol — canvas
  // never reads from them.
  const [tileUrl, setTileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isVideo || !tauriAvailable()) return;
    let cancelled = false;
    mediaUrl(row.path)
      .then((u) => {
        if (!cancelled) setTileUrl(u);
      })
      .catch(() => {});
    return () => {
        cancelled = true;
    };
  }, [isVideo, row.path]);

  /** click or drag anywhere on the bar seeks (the tile itself toggles play) */
  const seekTo = (clientX: number, el: HTMLElement) => {
    const v = videoRef.current;
    if (!v || !total) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * total;
    setShown(ratio * total);
  };

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

  const darkened = useMemo(
    () => (row.dominantColor ? darkenHex(row.dominantColor, 0.35) : null),
    [row.dominantColor],
  );

  return (
    <div
      className="group relative min-h-0 min-w-0 overflow-hidden rounded-2xl border border-white/[.08] bg-surface-1 shadow-[0_8px_28px_rgba(0,0,0,.35)]"
      // C2: dominant-color bed — a soft vertical wash instead of flat gray;
      // visible in the contain letterbox and as the pre-thumb placeholder
      style={{
        ...area,
        background: darkened
          ? `linear-gradient(160deg, ${darkened}, var(--surface-2))`
          : undefined,
      }}
      // click: play/pause for a video, the full viewer for a photo
      onClick={isVideo ? togglePlay : onOpen}
      onDoubleClick={onOpen}
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
          // P7 F3: loopback media server + crossOrigin keeps tiles CORS-clean,
          // so a tile handed to the full viewer can snapshot from day one;
          // fallback to the asset protocol keeps playback alive if it is down.
          src={tileUrl ?? fileSrc(row.path)}
          crossOrigin={tileUrl ? "anonymous" : undefined}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setShown(e.currentTarget.currentTime)}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setTotal(d);
          }}
          onProgress={(e) => {
            const el = e.currentTarget;
            if (el.buffered.length && el.duration > 0) {
              setBuffered(el.buffered.end(el.buffered.length - 1) / el.duration);
            }
          }}
          className={cn(
            "absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-[160ms]",
            playing ? "opacity-100" : "opacity-0",
          )}
          style={{ filter: "var(--video-filter, none)" }}
        />
      ) : (
        <img
          src={fileSrc(row.path)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}

      {/* the name of THIS tile, left-aligned, on hover only */}
      <span className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] truncate rounded-[8px] bg-black/45 px-2 py-1 font-mono text-[10.5px] text-white/90 opacity-0 backdrop-blur-sm transition-opacity duration-[160ms] group-hover:opacity-100">
        {row.path.split(/[\\/]/).pop()}
      </span>

      {!thumb && !row.path && (
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-ttertiary">
          {t("thumbs.noPreview")}
        </span>
      )}

      {/* video tile transport: mono timecodes + mini controls + a Material You
          scrubber. Videos play on a loop in a collage, so this bar is about
          jumping inside the clip, not about keeping it running. */}
      {isVideo && (
        <div
          className="absolute inset-x-3 bottom-3 z-20"
          onPointerEnter={() => setBarHover(true)}
          onPointerLeave={() => setBarHover(false)}
        >
          <div
            className={cn(
              "mb-2 flex items-end justify-between gap-2 transition-opacity duration-[160ms]",
              playing || barHover ? "opacity-100" : "opacity-0",
            )}
          >
            <span className="rounded-[7px] bg-black/45 px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-white/85 backdrop-blur-sm">
              {mmss(shown)} / {mmss(total)}
            </span>
            <div className="glass flex items-center gap-1 rounded-pill p-1">
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
          </div>
          <div
            role="slider"
            aria-label={t("player.seek")}
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(shown)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture?.(e.pointerId);
              seekTo(e.clientX, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return;
              e.stopPropagation();
              seekTo(e.clientX, e.currentTarget);
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative w-full cursor-pointer rounded-pill bg-white/15 transition-[height] duration-[160ms] ease-out",
              barHover ? "h-2.5" : "h-1.5",
            )}
          >
            <span
              className="pointer-events-none absolute inset-y-0 left-0 rounded-pill bg-white/25"
              style={{ width: `${buffered * 100}%` }}
            />
            <span
              className="pointer-events-none absolute inset-y-0 left-0 rounded-pill bg-accent"
              style={{ width: `${progress * 100}%` }}
            />
            <span
              className={cn(
                "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.5)] transition-transform duration-[140ms] ease-out",
                barHover ? "scale-100" : "scale-[.7]",
              )}
              style={{ left: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
