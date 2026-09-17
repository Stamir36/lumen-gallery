import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  EyeOff,
  Gauge,
  Heart,
  Info,
  Maximize2,
  Pause,
  PanelRight,
  PictureInPicture2,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SquareArrowOutUpRight,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { thumbSrc } from "@/lib/thumbs";
import { formatBytes, type MediaRow } from "@/lib/api";
import { useAppSettings } from "@/lib/settings";
import { useViewer } from "@/state/viewer";
import { NavTooltip } from "@/components/ui/NavTooltip";
import { Filmstrip } from "./Filmstrip";

const HIDE_AFTER_MS = 2_000;
const SAVE_EVERY_MS = 5_000;
/** ambient layer is skipped for huge frames: two 4K decoders is a stutter risk */
const AMBIENT_MAX_PIXELS = 3_840 * 2_160;

interface Progress {
  mediaId: number;
  positionMs: number;
  durationMs: number | null;
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Custom video player (STEP 2) — NO native controls, ever.
 *
 * Ambient mode: a blurred, oversized copy of the live frame sits behind the
 * letterboxed video (blur 60px, saturate 1.4, opacity .35) plus a vignette.
 * Controls are ONE floating glass pill (the only place blur is allowed), spring
 * in, auto-hidden after 2s of stillness, back on any pointer movement. Progress
 * is a 2px line that thickens to 6px on hover with a buffered ghost, mono
 * timecodes on both ends and a scrub-preview bubble over the hovered position.
 *
 * Resume positions live in `watch_progress` (written through the single writer
 * every ~5s and on unmount), so a film offers "continue 12:34" next time.
 */
export function VideoPlayer({ row }: { row: MediaRow }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const shell = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const ambient = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState((row.durationMs ?? 0) / 1000);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [chrome, setChrome] = useState(true);
  /** pointer is over the control pill — idle-hide must hold (FIX 1) */
  const [pillHover, setPillHover] = useState(false);
  /** FIX 3: manual interface hide (pill button / H) — wins over the idle timer */
  const [manualHide, setManualHide] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [barHover, setBarHover] = useState(false);
  const [scrub, setScrub] = useState<{ x: number; time: number } | null>(null);
  /** bubble preview element: shows the REAL frame at the hovered position */
  const bubble = useRef<HTMLVideoElement | null>(null);
  /** scrub updates are coalesced to one state change per frame */
  const scrubRef = useRef<{ x: number; time: number } | null>(null);
  const scrubRaf = useRef(0);
  const pushScrub = useCallback((next: { x: number; time: number } | null) => {
    scrubRef.current = next;
    if (scrubRaf.current) return;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = 0;
      setScrub(scrubRef.current);
    });
  }, []);

  // Seek the bubble to the hovered position — at most once per frame, and never
  // a re-seek for a movement the user cannot see (60 seeks/s on a 4K file would
  // stall the decoder the playback itself depends on).
  useEffect(() => {
    const el = bubble.current;
    if (!el || !scrub) return;
    const id = requestAnimationFrame(() => {
      try {
        if (Math.abs(el.currentTime - scrub.time) > 0.05) {
          el.currentTime = Math.max(0, scrub.time);
        }
      } catch {
        /* metadata not ready yet — the next move retries */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [scrub]);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Progress | null>(null);
  const hideAt = useRef<number>(0);
  const scrubbing = useRef(false);

  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);
  const infoOpen = useViewer((s) => s.infoOpen);
  const stripOpen = useViewer((s) => s.stripOpen);
  const toggleInfo = useViewer((s) => s.toggleInfo);
  const toggleStrip = useViewer((s) => s.toggleStrip);
  const favoriteOf = useViewer((s) => s.favoriteOf);
  const toggleFavorite = useViewer((s) => s.toggleFavorite);
  const pillAlign = useAppSettings((s) => s.pillAlign);

  const src = tauriAvailable() ? fileSrc(row.path) : "";
  const ambience = useMemo(
    () => !reduced && (row.width ?? 0) * (row.height ?? 0) <= AMBIENT_MAX_PIXELS,
    [reduced, row.width, row.height],
  );

  // ---------- resume position ----------
  useEffect(() => {
    if (!tauriAvailable()) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await invoke<Progress[]>("watch_progress", { ids: [row.id] });
        const p = rows[0];
        // only offer a resumable position (skip the first/last seconds)
        if (alive && p && p.positionMs > 5_000) {
          const total = (p.durationMs ?? row.durationMs ?? 0) / 1000;
          if (!total || p.positionMs < total * 1000 - 5_000) setResume(p);
        }
      } catch (e) {
        console.warn("watch_progress unavailable", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [row.id, row.durationMs]);

  // ---------- persist position (every 5s + on unmount) ----------
  const saveNow = useCallback(
    (force = false) => {
      const el = video.current;
      if (!tauriAvailable() || !el || (!force && el.paused)) return;
      const position = Math.round(el.currentTime * 1000);
      if (!force && position < 1_000) return;
      void invoke("save_progress", {
        id: row.id,
        positionMs: position,
        durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null,
      }).catch((e) => console.warn("save_progress failed", e));
    },
    [row.id],
  );

  useEffect(() => {
    const id = window.setInterval(() => saveNow(), SAVE_EVERY_MS);
    return () => {
      window.clearInterval(id);
      saveNow(true);
    };
  }, [saveNow]);

  // ---------- control chrome auto-hide (2s idle) ----------
  const poke = useCallback(() => {
    setChrome(true);
    hideAt.current = Date.now() + HIDE_AFTER_MS;
  }, []);

  // FIX 3: any pointer move, click or key press reveals the interface again
  // and resets the 2s idle timer.
  const revealControls = useCallback(() => {
    setManualHide(false);
    poke();
  }, [poke]);

  // FIX 3: manual hide — spring-hides pill, line, chips and the up-next rail.
  const hideInterface = useCallback(() => {
    setVolumeOpen(false);
    setManualHide(true);
    hideAt.current = Date.now() + HIDE_AFTER_MS;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const el = video.current;
      // FIX 1 holds — the chrome never idle-hides while: paused, scrubbing,
      // pointer over the bar or the pill, volume popover open, or the
      // codec-error card is up.
      if (
        !el ||
        el.paused ||
        scrubbing.current ||
        volumeOpen ||
        barHover ||
        pillHover ||
        error
      )
        return;
      setChrome(Date.now() < hideAt.current);
    }, 250);
    poke();
    return () => window.clearInterval(id);
  }, [poke, volumeOpen, barHover, pillHover, error]);

  // ---------- playback helpers ----------
  const toggle = useCallback(() => {
    const el = video.current;
    if (!el || error) return;
    if (el.paused) void el.play().catch((e) => setError(String(e)));
    else el.pause();
    poke();
  }, [error, poke]);

  const seekBy = useCallback(
    (delta: number) => {
      const el = video.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
      poke();
    },
    [poke],
  );

  const applyVolume = useCallback(
    (next: number) => {
      const el = video.current;
      const v = Math.max(0, Math.min(1, next));
      setVolume(v);
      setMuted(v === 0);
      if (el) {
        el.volume = v;
        el.muted = v === 0;
      }
      poke();
    },
    [poke],
  );

  // ---------- keyboard map (STEP 2 contract) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = video.current;
      const v = useViewer.getState();
      // FIX 3: H toggles the manual interface hide; any other key reveals.
      if (e.key === "h" || e.key === "H") {
        setVolumeOpen(false);
        setManualHide((prev) => !prev);
        hideAt.current = Date.now() + HIDE_AFTER_MS;
        return;
      }
      revealControls();
      if (e.key === "Escape") {
        // fullscreen first, viewer second
        if (document.fullscreenElement) return;
        v.close();
        return;
      }
      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        toggle();
      } else if (e.key === "j" || e.key === "J") seekBy(-10);
      else if (e.key === "l" || e.key === "L") seekBy(10);
      else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekBy(5);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekBy(-5);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        applyVolume(volume + 0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        applyVolume(volume - 0.05);
      } else if (e.key === "m" || e.key === "M") {
        applyVolume(muted || volume === 0 ? 1 : 0);
      } else if (e.key === "f" || e.key === "F") {
        toggleFavorite(row);
      } else if (e.key === "i" || e.key === "I") {
        toggleInfo();
      } else if (e.key === "," || e.key === "<") {
        if (el) el.currentTime = Math.max(0, el.currentTime - 1 / 25);
      } else if (e.key === "." || e.key === ">") {
        if (el) el.currentTime = Math.min(el.duration || 0, el.currentTime + 1 / 25);
      } else if (/^[0-9]$/.test(e.key)) {
        if (el && el.duration) {
          el.currentTime = (el.duration * Number(e.key)) / 10;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyVolume, row, seekBy, toggle, toggleFavorite, toggleInfo, volume, muted, revealControls]);

  // wheel = volume, attached natively so preventDefault is allowed (a passive
  // React handler cannot cancel the gesture)
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyVolume, volume]);

  const onFullscreen = () => {
    const el = shell.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch((e) => console.warn("fullscreen failed", e));
  };

  const onSnapshot = async () => {
    const el = video.current;
    if (!el) return;
    try {
      const w = Math.min(1920, el.videoWidth || 1280);
      const h = Math.round((w * (el.videoHeight || 720)) / (el.videoWidth || 1280));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(el, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("toBlob failed");
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const stem = (row.path.split(/[\\/]/).pop() ?? "frame").replace(/\.[^.]+$/, "");
      const saved = await invoke<string>("save_snapshot", {
        bytes,
        name: `${stem} ${clock(el.currentTime).replace(/:/g, "-")}`,
      });
      toast.success(t("player.snapshot_saved"), { description: saved });
    } catch (e) {
      console.error("snapshot failed", e);
      toast.error(t("player.snapshot_failed"));
    }
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const fav = favoriteOf(row);
  const nextRow = queue[index + 1];
  const chips = [
    row.width && row.height ? `${row.width}×${row.height}` : null,
    formatBytes(row.size),
    clock(duration),
  ].filter(Boolean) as string[];

  // FIX 1: one visibility condition for the pill AND the progress line —
  // the codec-error card keeps both up even past the 2s idle point.
  // FIX 3: the manual hide (H / pill button) wins over everything else.
  const showChrome = !manualHide && (chrome || !!error);

  return (
    <div
      ref={shell}
      className="relative flex h-full w-full overflow-hidden bg-black"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onDoubleClick={onFullscreen}
    >
      {/* ---------- ambient mode ---------- */}
      {ambience && !error && src && (
        <video
          ref={ambient}
          src={src}
          muted
          playsInline
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover"
          style={{ filter: "blur(60px) saturate(1.4)", opacity: 0.35 }}
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 220px 60px rgba(0,0,0,.85)" }}
      />

      {/* ---------- letterboxed video ---------- */}
      <video
        ref={video}
        src={src}
        playsInline
        loop={loop}
        className="relative z-10 m-auto max-h-full max-w-full"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          e.currentTarget.volume = volume;
        }}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime);
          if (ambient.current && Math.abs(ambient.current.currentTime - e.currentTarget.currentTime) > 1) {
            ambient.current.currentTime = e.currentTarget.currentTime;
          }
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length > 0) setBuffered(b.end(b.length - 1));
        }}
        onPlay={() => {
          setPlaying(true);
          poke();
          void ambient.current?.play().catch(() => undefined);
        }}
        onPause={() => {
          setPlaying(false);
          setChrome(true);
          saveNow();
          ambient.current?.pause();
        }}
        onError={() => setError("codec")}
      />

      {/* ---------- top-left glass chip row ---------- */}
      <AnimatePresence>
        {showChrome && !error && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
            className="absolute left-4 top-4 z-40 flex items-center gap-2"
          >
            <button
              type="button"
              aria-label={t("viewer.close")}
              title={t("viewer.close")}
              onClick={() => useViewer.getState().close()}
              className="glass flex h-10 w-10 items-center justify-center rounded-pill text-tprimary"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="glass flex h-10 max-w-[46vw] items-center gap-3 rounded-pill px-4">
              {/* the name leads, LEFT-aligned, then the mono format chips */}
              <span className="truncate text-[13px] font-medium text-tprimary">
                {row.path.split(/[\\/]/).pop()}
              </span>
              {chips.map((c) => (
                <span key={c} className="shrink-0 font-mono text-[11px] text-ttertiary">
                  {c}
                </span>
              ))}
            </div>
            <button
              type="button"
              aria-label={t("viewer.info")}
              title={t("viewer.info")}
              aria-pressed={infoOpen}
              onClick={toggleInfo}
              className={cn(
                "glass flex h-10 w-10 items-center justify-center rounded-pill",
                infoOpen ? "text-tprimary" : "text-tsecondary",
              )}
            >
              <Info size={17} />
            </button>
            <button
              type="button"
              aria-label={t("viewer.favorite")}
              title={t("viewer.favorite")}
              onClick={() => toggleFavorite(row)}
              className="glass flex h-10 w-10 items-center justify-center rounded-pill text-tprimary"
            >
              <Heart size={17} className={fav ? "fill-accent text-accent" : undefined} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- resume chip ---------- */}
      <AnimatePresence>
        {resume && !error && (
          <motion.button
            type="button"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            onClick={() => {
              const el = video.current;
              if (el) {
                el.currentTime = resume.positionMs / 1000;
                void el.play().catch(() => undefined);
              }
              setResume(null);
            }}
            className="glass absolute bottom-28 left-1/2 z-40 -translate-x-1/2 rounded-pill px-4 py-2 font-mono text-[11px] text-tprimary"
          >
            {t("player.resume", { time: clock(resume.positionMs / 1000) })}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ---------- codec / load failure card ---------- */}
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="w-[min(440px,88vw)] rounded-viewer bg-surface-2/95 p-6 text-center shadow-[0_16px_48px_rgba(0,0,0,.5)]">
            <p className="text-[15px] text-tprimary">{t("player.error_title")}</p>
            <p className="mt-2 font-mono text-[11px] text-ttertiary">
              {t("player.error_hint")}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() =>
                  void invoke("open_external", { path: row.path }).catch(() =>
                    toast.error(t("errors.action_failed")),
                  )
                }
                className="flex h-11 items-center gap-2 rounded-pill bg-white px-5 text-sm font-medium text-black transition-transform duration-[160ms] active:scale-[.97]"
              >
                <SquareArrowOutUpRight size={16} />
                {t("player.external")}
              </button>
              <button
                type="button"
                onClick={() => useViewer.getState().step(1)}
                disabled={!nextRow}
                className="flex h-11 items-center gap-2 rounded-pill bg-surface-3 px-5 text-sm text-tsecondary transition-colors hover:text-tprimary disabled:opacity-40"
              >
                {t("player.next_file")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- right rail: up next (collapsible) ---------- */}
      <AnimatePresence>
        {stripOpen && !manualHide && queue.length > 1 && (
          <motion.aside
            initial={reduced ? false : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="glass absolute bottom-4 right-3 top-4 z-40 flex w-[136px] flex-col rounded-viewer p-2.5"
          >
            <div className="mb-2 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ttertiary">
                {t("player.up_next")}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ttertiary">
                {index + 1}/{queue.length}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <Filmstrip vertical />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ---------- progress line + hover scrub bubble ----------
          FIX 1: the line is part of the controls cluster — same spring and
          opacity transition, and the same idle logic, as the pill. */}
      <AnimatePresence>
        {showChrome && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="absolute bottom-24 left-0 z-40 transition-[right] duration-[180ms] ease-out"
            style={{ right: stripOpen ? 152 : 0 }}
            onPointerEnter={() => setBarHover(true)}
            onPointerLeave={() => {
              setBarHover(false);
              pushScrub(null);
            }}
          >
        {barHover && scrub && (
          <div
            className="glass pointer-events-none absolute -top-20 w-[136px] -translate-x-1/2 rounded-viewer p-1"
            style={{ left: scrub.x }}
          >
            <div className="relative h-[68px] w-full overflow-hidden rounded-[10px] bg-black">
              {/* the cached thumbnail sits underneath; the real frame is seeked
                  on top of it — a bubble that always shows the first frame tells
                  you nothing about where you are about to jump */}
              {row.thumbPath && (
                // every thumb path goes through thumbSrc (convertFileSrc): a raw
                // DB path here floods DevTools with "Not allowed to load local
                // resource: file:///..."
                <img
                  src={thumbSrc(row.thumbPath)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                />
              )}
              <video
                ref={bubble}
                src={src}
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <p className="mt-1 text-center font-mono text-[10px] text-tsecondary">
              {clock(scrub.time)}
            </p>
          </div>
        )}
        {/* Material You scrubber: a thick rounded track that grows under the
            pointer, a buffered ghost behind the fill and a thumb that is always
            there (small at rest, full size on hover) — never a hairline */}
        <div
          ref={barRef}
          role="slider"
          aria-label={t("player.seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
          onPointerDown={(e) => {
            scrubbing.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const el = video.current;
            if (el && duration) el.currentTime = ratio * duration;
            poke();
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            pushScrub({ x: e.clientX - rect.left, time: ratio * duration });
            if (scrubbing.current && video.current && duration) {
              video.current.currentTime = ratio * duration;
            }
          }}
          onPointerUp={() => {
            scrubbing.current = false;
          }}
          className={cn(
            "group relative mx-6 cursor-pointer rounded-pill bg-white/12 transition-[height] duration-[160ms] ease-out",
            barHover || scrub !== null ? "h-2.5" : "h-1.5",
          )}
        >
          {/* buffered ghost */}
          <span
            className="pointer-events-none absolute inset-y-0 left-0 rounded-pill bg-white/20"
            style={{ width: `${bufferedRatio * 100}%` }}
          />
          <span
            className="pointer-events-none absolute inset-y-0 left-0 rounded-pill bg-accent"
            style={{ width: `${progress * 100}%` }}
          />
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,.55)] transition-transform duration-[140ms] ease-out",
              barHover || scrub !== null ? "scale-100" : "scale-[.72]",
            )}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <div className="mx-6 mt-1 flex items-center justify-between font-mono text-[11px] text-ttertiary">
          <span>{clock(current)}</span>
          <span>{clock(duration)}</span>
        </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- ONE floating glass control pill ---------- */}
      <AnimatePresence>
        {showChrome && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0, y: 16 } : { opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={cn(
              "absolute bottom-6 z-40",
              // Settings › Appearance: centre (default), left or right
              pillAlign === "left" && "left-6",
              pillAlign === "right" && "right-6",
              pillAlign === "center" && "left-1/2 -translate-x-1/2",
            )}
            role="toolbar"
            aria-label={t("viewer.controls")}
            onPointerEnter={() => setPillHover(true)}
            onPointerLeave={() => setPillHover(false)}
          >
            <div className="glass flex h-14 items-center gap-1 rounded-pill px-2">
              <IconBtn label={t("player.back10")} onClick={() => seekBy(-10)}>
                <RotateCcw size={18} />
              </IconBtn>
              <button
                type="button"
                aria-label={playing ? t("player.pause") : t("player.play")}
                title={playing ? t("player.pause") : t("player.play")}
                onClick={toggle}
                className="mx-1 flex h-12 w-12 items-center justify-center rounded-pill bg-white text-black transition-transform duration-[160ms] active:scale-[.95]"
              >
                {playing ? (
                  <Pause size={22} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play size={22} fill="currentColor" strokeWidth={0} />
                )}
              </button>
              <IconBtn label={t("player.fwd10")} onClick={() => seekBy(10)}>
                <RotateCw size={18} />
              </IconBtn>

              <span className="mx-1 h-6 w-px bg-white/10" />

              {/* volume popover */}
              <div className="relative">
                <IconBtn
                  label={muted ? t("player.unmute") : t("player.mute")}
                  onClick={() => {
                    setVolumeOpen((o) => !o);
                  }}
                >
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </IconBtn>
                <AnimatePresence>
                  {volumeOpen && (
                    <motion.div
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      className="glass absolute bottom-14 left-1/2 flex h-[168px] w-12 -translate-x-1/2 items-center justify-center rounded-pill"
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(volume * 100)}
                        aria-label={t("player.volume")}
                        onChange={(e) => applyVolume(Number(e.target.value) / 100)}
                        className="h-1 w-28 -rotate-90 cursor-pointer appearance-none rounded-pill bg-white/15 accent-accent"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* speed menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={t("player.speed")}
                    title={t("player.speed")}
                    className="flex h-10 items-center gap-1 rounded-pill px-2 font-mono text-[11px] text-tsecondary transition-colors hover:bg-white/[.08] hover:text-tprimary"
                  >
                    <Gauge size={17} />
                    {rate}×
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="top"
                    align="center"
                    sideOffset={10}
                    className="z-[140] min-w-[148px] rounded-control bg-surface-2 p-1 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
                  >
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <DropdownMenu.Item
                        key={r}
                        onSelect={() => {
                          const el = video.current;
                          if (el) el.playbackRate = r;
                          setRate(r);
                        }}
                        className={cn(
                          "flex h-10 cursor-pointer items-center rounded-[10px] px-3 font-mono text-[12px] outline-none",
                          r === rate
                            ? "bg-white/[.08] text-tprimary"
                            : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
                        )}
                      >
                        {r}×
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <IconBtn
                label={t("player.loop")}
                active={loop}
                onClick={() => {
                  const el = video.current;
                  const next = !loop;
                  setLoop(next);
                  if (el) el.loop = next;
                }}
              >
                <Repeat size={18} />
              </IconBtn>
              <IconBtn label={t("player.snapshot")} onClick={() => void onSnapshot()}>
                <Camera size={18} />
              </IconBtn>
              <IconBtn
                label={t("player.pip")}
                onClick={() => {
                  const el = video.current as
                    | (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })
                    | null;
                  void el?.requestPictureInPicture?.().catch(() =>
                    toast.error(t("player.pip_failed")),
                  );
                }}
              >
                <PictureInPicture2 size={18} />
              </IconBtn>
              <IconBtn label={t("player.up_next")} active={stripOpen} onClick={toggleStrip}>
                <PanelRight size={18} />
              </IconBtn>
              {/* FIX 3: manual interface hide — mono tooltip + hotkey H */}
              <NavTooltip
                label={t("player.hide_interface")}
                caption="H"
                side="top"
                mono
              >
                <button
                  type="button"
                  aria-label={t("player.hide_interface")}
                  aria-pressed={manualHide}
                  onClick={hideInterface}
                  className="flex h-10 w-10 items-center justify-center rounded-pill text-tsecondary transition-all duration-[160ms] ease-out hover:bg-white/[.08] hover:text-tprimary active:scale-[.97]"
                >
                  <EyeOff size={18} />
                </button>
              </NavTooltip>
              <IconBtn label={t("player.fullscreen")} onClick={onFullscreen}>
                <Maximize2 size={18} />
              </IconBtn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- mono info panel (same contract as the lightbox) ---------- */}
      <AnimatePresence>
        {infoOpen && (
          <motion.aside
            initial={reduced ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
            className="absolute left-4 top-20 z-40 w-[320px] rounded-viewer bg-surface-2/95 p-4 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
          >
            <dl className="flex flex-col gap-2 font-mono text-[11px]">
              {[
                [t("viewer.info_path"), row.path],
                [t("viewer.info_res"), row.width && row.height ? `${row.width}×${row.height}` : "—"],
                [t("viewer.info_size"), formatBytes(row.size)],
                [t("viewer.info_date"), new Date(row.mtime).toLocaleString()],
                [t("viewer.info_ext"), row.ext.toUpperCase()],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-24 shrink-0 uppercase tracking-[0.08em] text-ttertiary">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 break-all text-tsecondary">{value}</dd>
                </div>
              ))}
            </dl>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-pill transition-all duration-[160ms] ease-out active:scale-[.97]",
        active
          ? "bg-white/[.14] text-tprimary"
          : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
      )}
    >
      {children}
    </button>
  );
}
