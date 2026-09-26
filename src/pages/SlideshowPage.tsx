import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Shuffle,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { readSetting, writeSetting } from "@/i18n";
import { IconButton } from "@/components/ui/IconButton";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { thumbSrc } from "@/lib/thumbs";
import { useAppSettings } from "@/lib/settings";
import { useMediaRows } from "@/lib/queries";
import { filterForRoute, useLibraryUi } from "@/state/library-ui";
import { useViewer } from "@/state/viewer";
import type { MediaRow } from "@/lib/api";

/**
 * Slideshow — the one thing a photo gallery was still missing: hands-off
 * playback of whatever the grid is currently showing.
 *
 * It owns no data of its own. The rows come from the SAME react-query key the
 * grid uses (the route, search, chip and sort all feed `useMediaRows`), so
 * opening the slideshow shows exactly the view you were looking at, from the
 * cache, with no extra round trip and no new Rust command.
 *
 * Photos only, on purpose: a slideshow of videos is a playlist, and the video
 * player already owns that.
 */

const INTERVALS = [3, 5, 8, 12, 20];

/**
 * Slide duration and caption are remembered in the same `settings` kv the rest
 * of the app uses — through the generic helpers, so this page adds no shared
 * state of its own. Shuffle is deliberately not remembered: it is a choice
 * about THIS show, not a preference.
 */
const PREF_KEY = "slideshow.prefs";

/** How long the pointer has to sit still before the chrome gets out of the way. */
const IDLE_MS = 2600;

function fileNameOf(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function SlideshowPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const route = useLibraryUi((s) => s.route);
  const q = useLibraryUi((s) => s.q);
  const chip = useLibraryUi((s) => s.chip);
  const sort = useLibraryUi((s) => s.sort);
  const desc = useLibraryUi((s) => s.desc);
  const motionOn = useAppSettings((s) => s.uiMotion);
  /** opening a slideshow means the gallery has been seen (P2 session rule) */
  const visitGallery = useViewer((s) => s.visitGallery);

  const media = useMediaRows({
    filter: filterForRoute(route, chip),
    sort,
    desc,
    q,
    rootId: route.kind === "root" ? route.rootId : null,
    dir: route.kind === "root" ? route.dir : null,
    enabled: true,
  });

  /** the slides, in view order — videos are not part of a photo slideshow */
  const photos: MediaRow[] = useMemo(
    () => (media.data ?? []).filter((r) => r.kind === "image" && !r.trashed),
    [media.data],
  );

  const [order, setOrder] = useState<number[] | null>(null);
  const sequence = useMemo(() => {
    const base = photos.map((_, i) => i);
    return order ?? base;
  }, [photos, order]);

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalSec, setIntervalSec] = useState(5);
  const [caption, setCaption] = useState(true);
  const [idle, setIdle] = useState(false);
  /** the CURRENT slide is decoded; only then does it fade in — no black flash */
  const [loaded, setLoaded] = useState(false);
  /** drives the Ken Burns drift and the progress bar (restarts per slide) */
  const [drift, setDrift] = useState(false);
  /** the NEXT slide decodes behind the current one — the transition never
      waits on the disk, which is what read as a "black screen between slides" */
  const [nextReady, setNextReady] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  const total = sequence.length;
  const photoIndex = sequence[cursor] ?? 0;
  const row = photos[photoIndex];
  const nextRow = total > 1 ? photos[sequence[(cursor + 1) % total]] : undefined;

  useEffect(() => {
    visitGallery();
  }, [visitGallery]);

  // remembered preferences (best-effort: a browser preview has no database)
  useEffect(() => {
    let cancelled = false;
    readSetting(PREF_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const saved = JSON.parse(raw) as { interval?: number; caption?: boolean };
        if (typeof saved.interval === "number" && INTERVALS.includes(saved.interval)) {
          setIntervalSec(saved.interval);
        }
        if (typeof saved.caption === "boolean") setCaption(saved.caption);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = (nextInterval: number, nextCaption: boolean) => {
    void writeSetting(
      PREF_KEY,
      JSON.stringify({ interval: nextInterval, caption: nextCaption }),
    ).catch(() => undefined);
  };

  // a query change (new search, another smart view) restarts the show on a
  // fresh sequence — keeping a cursor into a list that no longer exists would
  // silently land on an unrelated photo. Keyed on the QUERY INPUTS rather than
  // on `media.data`, so a background refetch of the same view does not throw
  // the viewer back to the first slide.
  useEffect(() => {
    setOrder(null);
    setCursor(0);
  }, [route, q, chip, sort, desc]);

  useEffect(() => {
    if (cursor >= total) setCursor(0);
  }, [cursor, total]);

  /** Ken Burns + progress: flip the flag one frame after the slide changes. */
  useEffect(() => {
    setLoaded(false);
    setDrift(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setDrift(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [photoIndex]);

  const next = useCallback(() => setCursor((c) => (total === 0 ? 0 : (c + 1) % total)), [total]);
  const prev = useCallback(
    () => setCursor((c) => (total === 0 ? 0 : (c - 1 + total) % total)),
    [total],
  );

  // the tick
  useEffect(() => {
    if (!playing || total < 2) return;
    const id = window.setInterval(next, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [playing, total, intervalSec, next]);

  // chrome fades while the pointer is still
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  // deliberate hoisted declarations: `exit` and `shuffle` are referenced by the
  // keydown effect below, which reads nothing but the router and the sequence —
  // dependency-lint noise, not a stale-closure risk.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  function shuffle() {
    if (total < 2) return;
    const rest = sequence.filter((_, i) => i !== cursor);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    setOrder([sequence[cursor] ?? 0, ...rest]);
    setCursor(0);
  }

  /** The slideshow owns no window state, so leaving is just leaving. */
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  function exit() {
    navigate("/");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exit();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key.toLowerCase() === "s") {
        shuffle();
      } else if (e.key.toLowerCase() === "c") {
        setCaption((c) => {
          remember(intervalSec, !c);
          return !c;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `exit`/`shuffle` are hoisted declarations reading only the router/list
  }, [next, prev, total, sequence, cursor, intervalSec]);

  async function toggleFullscreen() {
    if (!tauriAvailable()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    win.setFullscreen(!(await win.isFullscreen())).catch(() => undefined);
  }

  const src = row
    ? tauriAvailable()
      ? fileSrc(row.path)
      : row.thumbPath
        ? thumbSrc(row.thumbPath)
        : ""
    : "";
  const nextSrc = nextRow
    ? tauriAvailable()
      ? fileSrc(nextRow.path)
      : nextRow.thumbPath
        ? thumbSrc(nextRow.thumbPath)
        : ""
    : "";

  // hidden pre-decode of the NEXT original: when the tick fires, the bytes are
  // already in the browser cache and the swap is a paint, not a fetch
  useEffect(() => {
    setNextReady(false);
    if (!nextSrc) return;
    const img = new Image();
    img.onload = () => setNextReady(true);
    img.src = nextSrc;
  }, [nextSrc]);

  const showFallback = !media.isPending && total === 0;

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden bg-black"
      // the opening move: the whole stage rises from a slight zoom — the
      // slideshow should read as an "event", not a page swap
      initial={motionOn ? { opacity: 0, scale: 1.03 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* the slide — keyed: each slide is a fresh element, so the enter
          animation below always runs (a prop-only swap would crossfade the
          same node between two different pictures) */}
      {row && (
        <motion.img
          key={row.id}
          src={src}
          alt={caption ? fileNameOf(row.path) : ""}
          onLoad={() => setLoaded(true)}
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-contain"
          initial={false}
          animate={{ opacity: loaded ? 1 : 0, scale: motionOn && drift ? 1.045 : 1 }}
          transition={{
            opacity: { duration: 0.5, ease: "easeOut" },
            // the drift runs for exactly one slide, linear — Ken Burns
            scale: {
              duration: motionOn ? intervalSec * 1000 : 0,
              ease: "linear",
            },
          }}
        />
      )}
      {/* the next slide decodes behind the current one — no gap on the swap */}
      {nextSrc && (
        <img src={nextSrc} alt="" aria-hidden className="hidden" data-ready={nextReady} />
      )}

      {/* click anywhere toggles playback, like every other viewer */}
      <button
        type="button"
        aria-label={playing ? t("slideshow.pause") : t("slideshow.play")}
        onClick={() => setPlaying((p) => !p)}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      {/* caption */}
      {caption && row && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-6 pb-24 pt-16 text-center transition-opacity duration-[240ms]",
            idle ? "opacity-0" : "opacity-100",
          )}
        >
          <span className="max-w-[70ch] truncate text-sm font-medium text-white/90">
            {fileNameOf(row.path)}
          </span>
          <span className="font-mono text-[11px] text-white/45">
            {row.width && row.height ? `${row.width}×${row.height} · ` : ""}
            {cursor + 1} / {total}
          </span>
        </div>
      )}

      {/* chrome */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex justify-center pb-6 transition-opacity duration-[240ms]",
          idle && playing ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <div className="flex items-center gap-1 rounded-pill border border-hairline bg-surface-2 px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,.45)] backdrop-blur-md">
          <IconButton label={t("slideshow.previous")} onClick={prev}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label={playing ? t("slideshow.pause") : t("slideshow.play")}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <IconButton label={t("slideshow.next")} onClick={next}>
            <ChevronRight size={18} />
          </IconButton>

          <span className="mx-1 h-5 w-px bg-hairline" />

          <IconButton
            label={t("slideshow.interval")}
            onClick={() => {
              const at = INTERVALS.indexOf(intervalSec);
              const nextInterval = INTERVALS[(at + 1) % INTERVALS.length];
              setIntervalSec(nextInterval);
              remember(nextInterval, caption);
            }}
          >
            <span className="flex items-center gap-1">
              <Gauge size={16} />
              <span className="font-mono text-[11px]">{intervalSec}s</span>
            </span>
          </IconButton>
          <IconButton
            label={t("slideshow.caption")}
            aria-pressed={caption}
            onClick={() => {
              setCaption((c) => {
                remember(intervalSec, !c);
                return !c;
              });
            }}
            className={cn(caption && "bg-surface-3 text-tprimary")}
          >
            <Type size={16} />
          </IconButton>
          <IconButton label={t("slideshow.shuffle")} onClick={shuffle}>
            <Shuffle size={16} />
          </IconButton>
          <IconButton label={t("slideshow.fullscreen")} onClick={() => void toggleFullscreen()}>
            <Maximize2 size={16} />
          </IconButton>

          <span className="mx-1 h-5 w-px bg-hairline" />

          <IconButton label={t("slideshow.exit")} onClick={exit}>
            <X size={18} />
          </IconButton>
        </div>
      </div>

      {/* progress line: one pass per slide, restarting with the drift */}
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/5">
        <div
          className="h-full origin-left bg-accent"
          style={{
            transform: playing && drift ? "scaleX(1)" : "scaleX(0)",
            transition:
              playing && drift ? `transform ${intervalSec * 1000}ms linear` : "transform 0ms",
          }}
        />
      </div>

      {/* keyboard hint, only until the first key is pressed */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-6 transition-opacity duration-[240ms]",
          idle ? "opacity-0" : "opacity-100",
        )}
      >
        <span className="rounded-pill bg-black/45 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/50">
          {t("slideshow.hint")}
        </span>
      </div>

      {/* empty view: AFTER the chrome so the exit pill is reachable */}
      {showFallback && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black px-8 text-center">
          <p className="text-sm font-medium text-tprimary">{t("slideshow.empty_title")}</p>
          <p className="max-w-[42ch] text-[13px] text-ttertiary">{t("slideshow.empty_hint")}</p>
          <button
            type="button"
            onClick={exit}
            className="mt-1 rounded-pill bg-surface-2 px-4 py-2 text-[13px] text-tprimary transition-colors hover:bg-surface-3"
          >
            {t("slideshow.exit")}
          </button>
        </div>
      )}
    </motion.div>
  );
}
