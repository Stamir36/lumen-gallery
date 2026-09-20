import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Droplet,
  ExternalLink,
  EyeOff,
  FlipHorizontal,
  Gauge,
  Heart,
  Info,
  Maximize2,
  MoreHorizontal,
  Palette,
  Pause,
  PanelRight,
  PictureInPicture2,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Shuffle,
  Sparkles,
  SquareArrowOutUpRight,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { mediaUrl } from "@/lib/api";
import { tauriAvailable } from "@/lib/assets";
import { thumbSrc } from "@/lib/thumbs";
import { formatBytes, type MediaRow } from "@/lib/api";
import { useMediaSource } from "@/lib/mediaSource";
import { baseName } from "@/lib/format";
import { readFile } from "@tauri-apps/plugin-fs";
import { useAppSettings } from "@/lib/settings";
import { useViewer } from "@/state/viewer";
import { Slider } from "@/components/ui/Slider";
import { NavTooltip } from "@/components/ui/NavTooltip";
import { Filmstrip } from "./Filmstrip";
import { VrView } from "./VrView";

const HIDE_AFTER_MS = 2_000;
/** MediaError code for "the source stopped delivering bytes" (B15). */
const MEDIA_ERR_NETWORK = 2;
const SAVE_EVERY_MS = 5_000;
/** blob fallback ceiling: beyond this the bytes do not belong in one Blob */
const VR_BLOB_MAX = 256 * 1024 * 1024;
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
  /** P7 F3: the "…" overflow popover (snapshot / external / PiP / loop) */
  const [overflowOpen, setOverflowOpen] = useState(false);
  /** F2: the popover renders through a PORTAL (a blur surface nested inside
   *  the glass pill sampled the pill's backdrop root, not the video — the
   *  frosting vanished). Fixed position, anchored to the "…" button. */
  const moreAnchorRef = useRef<HTMLSpanElement>(null);
  const [overflowPos, setOverflowPos] = useState({ left: 0, bottom: 0 });
  const toggleOverflow = () => {
    if (overflowOpen) {
      setOverflowOpen(false);
      return;
    }
    const r = moreAnchorRef.current?.getBoundingClientRect();
    if (r) setOverflowPos({ left: r.right - 252, bottom: window.innerHeight - r.top + 8 });
    setOverflowOpen(true);
  };
  /** P7 F4: color-correction popover inside the overflow */
  const [colorOpen, setColorOpen] = useState(false);
  /** FIX 3: manual interface hide (pill button / H) — wins over the idle timer */
  const [manualHide, setManualHide] = useState(false);
  /** VR immersion (SBS 180): mono projection of one stereo half */
  const [vrMode, setVrMode] = useState(false);
  const [vrEye, setVrEye] = useState<0 | 1>(0);
  /** natural size from metadata (row.width/height can be NULL until thumbs) */
  const [nat, setNat] = useState({ w: 0, h: 0 });
  /**
   * VR needs a CORS-clean source: the asset protocol taints the canvas, which
   * is what kept the dome black. Loopback media server first, blob fallback for
   * files small enough to hold in memory, error card otherwise.
   */
  const [vrSrc, setVrSrc] = useState<string | null>(null);
  const [vrError, setVrError] = useState(false);
  /** playback position carried into the VR element (and back on exit) */
  const vrResumeAt = useRef<number>(0);
  /** VR draws from its own CORS-clean element (FIX 1) — controls target it */
  const vrVideo = useRef<HTMLVideoElement | null>(null);
  /** was the main element playing when VR was entered → resume on exit */
  const wasPlayingBeforeVr = useRef(false);
  /** was the main element playing when VR was entered → resume on exit */
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
  // P2: the X closes the app window for an external-file session
  const session = useViewer((s) => s.session);
  const requestClose = useViewer((s) => s.requestClose);
  // P6: session queue order — randomise, or restore the grid order exactly
  const shuffled = useViewer((s) => s.order === "shuffle");
  const toggleShuffle = useViewer((s) => s.toggleShuffle);
  const toggleStrip = useViewer((s) => s.toggleStrip);
  const favoriteOf = useViewer((s) => s.favoriteOf);
  const toggleFavorite = useViewer((s) => s.toggleFavorite);
  const pillAlign = useAppSettings((s) => s.pillAlign);
  const videoAutoplay = useAppSettings((s) => s.videoAutoplay);

  // The MAIN video source follows ONE app-wide policy (src/lib/mediaSource.ts):
  // the asset protocol by default — it answers instantly, while the loopback
  // media server adds a hop that delays first frame and seeks (user report).
  // Opt-in "use media server" (Settings › Playback) restores CORS-clean frames
  // for the snapshot; with the asset protocol frames are tainted: playback
  // fine, snapshot hidden (the button is simply not rendered).
  const { src, clean: srcClean } = useMediaSource(row.path);
  const mediaSrcTainted = !srcClean;
  // VR sources are name-driven (the library encodes it in file names): a
  // standalone "VR" token ("… 8K VR.mkv", "VR180 …"), or "SBS 180" PLUS an
  // actual stereo-pair frame — two 1:1 halves side by side, aspect ≈ 2:1
  // (e.g. 7680×3840). A bare aspect match alone kept offering VR on 2.35:1
  // cinema rips.
  const vrName = baseName(row.path);
  // standalone "VR" token — \p{L}/\p{N} keep it script-agnostic (a Cyrillic
  // name like "ЛекцияVR.mkv" must NOT match, "Лекция VR 8K.mkv" must)
  const hasVrToken = /(?:^|[^\p{L}\p{N}])vr\d*(?:[^\p{L}\p{N}]|$)/iu.test(vrName);
  const hasSbs180 = /sbs[\s._-]*180/i.test(vrName);
  const effW = row.width ?? nat.w;
  const effH = row.height ?? nat.h;
  const stereoPair =
    effW > 0 && effH > 0 && Math.abs(effW / effH - 2) <= 0.25;
  const isVrSource = hasVrToken || (hasSbs180 && stereoPair);

  // Resolve the VR source when the mode is toggled on
  useEffect(() => {
    if (!vrMode) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    // drop any stale source from a previous session/row — VrView mounts only
    // once THIS row's clean URL is resolved
    setVrSrc(null);
    vrResumeAt.current = video.current ? video.current.currentTime : 0;

    const resolve = async () => {
      // F3: a CORS-clean main source is reused directly
      if (src && !mediaSrcTainted) {
        setVrError(false);
        setVrSrc(src);
        return;
      }
      try {
        const url = await mediaUrl(row.path);
        if (!cancelled) {
          setVrError(false);
          setVrSrc(url);
        }
        return;
      } catch (e) {
        console.warn("vr: media server unavailable, trying the blob fallback", e);
      }
      if (row.size > VR_BLOB_MAX) {
        if (!cancelled) setVrError(true);
        return;
      }
      try {
        const bytes = await readFile(row.path);
        blobUrl = URL.createObjectURL(new Blob([bytes]));
        if (!cancelled) {
          setVrError(false);
          setVrSrc(blobUrl);
        }
      } catch (e) {
        console.error("vr: blob fallback failed", e);
        if (!cancelled) setVrError(true);
      }
    };
    void resolve();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [vrMode, row.path, row.size, src, mediaSrcTainted]);
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
      const el = vrVideo.current ?? video.current;
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

  // FIX 1: exit the dome — copy the position back, resume the main element.
  const exitVr = useCallback(() => {
    const vr = vrVideo.current;
    const main = video.current;
    if (vr && main) main.currentTime = vr.currentTime;
    vrVideo.current = null;
    setVrMode(false);
    if (wasPlayingBeforeVr.current && main) {
      void main.play().catch(() => undefined);
    }
    wasPlayingBeforeVr.current = false;
    poke();
  }, [poke]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const el = vrVideo.current ?? video.current;
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
    const el = vrVideo.current ?? video.current;
    if (!el || error) return;
    if (el.paused) void el.play().catch((e) => setError(String(e)));
    else el.pause();
    poke();
  }, [error, poke]);

  const seekBy = useCallback(
    (delta: number) => {
      const el = vrVideo.current ?? video.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
      poke();
    },
    [poke],
  );

  const applyVolume = useCallback(
    (next: number) => {
      const el = vrVideo.current ?? video.current;
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
      const el = vrVideo.current ?? video.current;
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
        // VR first: one Esc leaves the dome, the next closes the viewer
        if (vrMode) {
          exitVr();
          return;
        }
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
  }, [applyVolume, row, seekBy, toggle, toggleFavorite, toggleInfo, volume, muted, revealControls, vrMode, exitVr]);

  // P1: the color sheet is its own surface — Esc closes IT, not the viewer.
  useEffect(() => {
    if (!colorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setColorOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [colorOpen]);

  // P7 F3: the overflow closes on outside click / Esc; stopImmediatePropagation
  // keeps the viewer's own Esc handler from closing the whole viewer.
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest("[data-overflow-root]")) setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOverflowOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [overflowOpen]);

  // F5: the mini window hands the position back (button / Esc / X / Alt+F4);
  // the main player seeks there and resumes exactly where the mini stopped.
  const rowIdRef = useRef(row.id);
  rowIdRef.current = row.id;
  useEffect(() => {
    if (!tauriAvailable()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ mediaId: number; positionMs: number }>("mini-return", (e) => {
      const p = e.payload;
      if (!p || p.mediaId !== rowIdRef.current) return;
      const el = vrVideo.current ?? video.current;
      if (!el) return;
      el.currentTime = p.positionMs / 1000;
      void el.play().catch(() => undefined);
    }).then((off) => {
      unlisten = off;
    });
    return () => unlisten?.();
  }, []);

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
    const el = vrVideo.current ?? video.current;
    if (!el) return;
    try {
      const w = Math.min(1920, el.videoWidth || 1280);
      const h = Math.round((w * (el.videoHeight || 720)) / (el.videoWidth || 1280));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(el, 0, 0, w, h);
      // F3: the loopback server keeps frames CORS-clean, so toBlob succeeds —
      // the asset:// source tainted the canvas and this exact line threw.
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("toBlob failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success(t("player.snapshot_copied"));
    } catch (e) {
      console.error("snapshot failed", e);
      toast.error(t("player.snapshot_failed"));
    }
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const fav = favoriteOf(row);
  const nextRow = queue[index + 1];
  const canPrev = index > 0;
  const canNext = index < queue.length - 1;
  // the res/size/duration chips left the top bar (bug: the bar read as an
  // overloaded strip) — they live in the info panel, which still owns them

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
      {ambience && !error && src && !vrMode && (
        <video
          ref={ambient}
          src={src || undefined}
          crossOrigin="anonymous"
          muted
          playsInline
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover"
          style={{ filter: "blur(60px) saturate(1.4) var(--video-filter, none)", opacity: 0.35 }}
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 220px 60px rgba(0,0,0,.85)" }}
      />

      {/* ---------- letterboxed video (scales UP to fill the stage too;
          object-contain letterboxes inside the element) ---------- */}
      <video
        ref={video}
        src={src || undefined}
        crossOrigin="anonymous"
        playsInline
        loop={loop}
        className="relative z-10 h-full w-full object-contain"
        style={{ filter: "var(--video-filter, none)" }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          const vw = e.currentTarget.videoWidth;
          const vh = e.currentTarget.videoHeight;
          setNat({ w: vw, h: vh });
          // the info panel reads row.width/height, which stay NULL until the
          // thumbnail pipeline fills them — persist the decoder's own values
          // (single writer; whitelisted COALESCE keeps scanned values intact)
          if (vw > 0 && vh > 0 && (!row.width || !row.height)) {
            void invoke("db_exec", {
              sql: "UPDATE media SET width = COALESCE(width, NULLIF(?1, 0)), height = COALESCE(height, NULLIF(?2, 0)) WHERE id = ?3",
              params: [String(vw), String(vh), String(row.id)],
            }).catch(() => undefined);
          }
          e.currentTarget.volume = volume;
          // Settings › Appearance: play at once (the click that opened the
          // viewer is the user activation WebView2 requires for sound)
          if (videoAutoplay) void e.currentTarget.play().catch(() => undefined);
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
        onError={(e) => {
          // B15: a pulled USB drive or a dropped network share is NOT a codec
          // problem. Chromium gives both as a bare error event, but the code
          // distinguishes "the bytes stopped arriving" from "I cannot decode
          // this", and the copy must match what actually happened.
          const code = e.currentTarget.error?.code;
          setError(code === MEDIA_ERR_NETWORK ? "io" : "codec");
        }}
      />

      {/* ---------- VR immersion (SBS 180): mono 180° projection. Draws from
          a DEDICATED CORS-clean element (FIX 1): crossOrigin must be set on a
          FRESH element BEFORE its src — swapping src/crossOrigin on the already
          loaded main element is ignored and the frames stay tainted. The main
          element keeps its asset:// source untouched; VrView carries playback
          (audio, decode, position) inside the dome. ---------- */}
      {vrMode && vrSrc && (
        <VrView
          videoRef={vrVideo}
          src={vrSrc}
          startAt={vrResumeAt.current}
          eye={vrEye}
          volume={volume}
          muted={muted}
          rate={rate}
          loop={loop}
          onTime={setCurrent}
          onPlayState={setPlaying}
          onFatal={() => {
            // tainted frame: leave the dome instead of a black canvas
            setVrError(true);
            exitVr();
          }}
        />
      )}

      {/* VR source unavailable: mono chip, never a silent black stage */}
      {vrError && (
        <div className="absolute inset-x-0 top-20 z-50 flex justify-center">
          <div className="glass flex items-center gap-3 rounded-pill px-4 py-2">
            <span className="font-mono text-[11px] text-tprimary">
              {t("player.vr_unavailable")}
            </span>
            <button
              type="button"
              onClick={() => setVrError(false)}
              className="font-mono text-[11px] text-ttertiary transition-colors hover:text-tprimary"
            >
              {t("viewer.close")}
            </button>
          </div>
        </div>
      )}

      {/* ---------- top window-drag band ----------
            Frameless window + fullscreen-ish video: without this band there is
            NOWHERE to grab the window while the viewer is open (F1). It sits
            UNDER the chrome bar; the bar's own background drags too. */}
      <div
        data-tauri-drag-region="true"
        onMouseDown={(e) => {
          if (e.buttons === 1) void getCurrentWindow().startDragging();
        }}
        className="absolute inset-x-0 top-0 z-30 h-16 cursor-default"
      />

      {/* ---------- top-left glass chip row ---------- */}
      <AnimatePresence>
        {showChrome && !error && (
          <motion.div
            /* glass + animated opacity = backdrop-filter is isolated while
               opacity < 1, then pops in at 1 — animate TRANSFORM only */
            initial={reduced ? false : { y: -12 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            data-tauri-drag-region="true"
            onMouseDown={(e) => {
              // only the bar's own background drags; every control (and the
              // name pill) is a child that becomes the event target itself
              if (e.target === e.currentTarget && e.buttons === 1) {
                void getCurrentWindow().startDragging();
              }
            }}
            className="absolute inset-x-4 top-4 z-40 flex items-center gap-2"
          >
            {/* LEFT — back to the gallery, and the X ONLY when this window was
                OPENED with the file (P2 semantics). In an internal session the
                X did exactly what the back arrow does, so it is not rendered
                at all: one action, one affordance. */}
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label={t("viewer.back")}
                title={t("viewer.back")}
                onClick={() => useViewer.getState().close()}
                className="glass flex h-10 w-10 items-center justify-center rounded-pill text-tprimary transition-colors duration-[160ms] hover:bg-white/[.12]"
              >
                <ArrowLeft size={18} />
              </button>
              {session === "external" && (
                <button
                  type="button"
                  aria-label={t("viewer.close_app")}
                  title={t("viewer.close_app")}
                  onClick={requestClose}
                  className="glass flex h-10 w-10 items-center justify-center rounded-pill text-tprimary transition-colors duration-[160ms] hover:bg-white/[.12]"
                >
                  <X size={17} />
                </button>
              )}

              {/* the name leads, directly behind the back arrow (as it always
                  did); the mono res/size/duration chips stay in the info panel
                  so the bar keeps one focal element */}
              <div className="glass pointer-events-none flex h-10 min-w-0 max-w-[46vw] items-center gap-3 rounded-pill px-4">
                <span className="truncate text-[13px] font-medium text-tprimary">
                  {row.path.split(/[\\/]/).pop()}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ttertiary">
                  {index + 1} / {queue.length}
                </span>
              </div>
            </div>

            {/* RIGHT — the quiet actions, pushed to the far edge */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label={t("viewer.shuffle")}
                title={t(shuffled ? "viewer.shuffle_off" : "viewer.shuffle")}
                aria-pressed={shuffled}
                onClick={toggleShuffle}
                className={cn(
                  "glass flex h-10 w-10 items-center justify-center rounded-pill transition-colors duration-[160ms]",
                  shuffled ? "text-accent" : "text-tsecondary hover:text-tprimary",
                )}
              >
                <Shuffle size={17} />
              </button>
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- resume chip ---------- */}
      <AnimatePresence>
        {resume && !error && (
          <motion.button
            type="button"
            initial={reduced ? false : { y: 8 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: 8 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={() => {
              const el = vrVideo.current ?? video.current;
              if (el) {
                el.currentTime = resume.positionMs / 1000;
                void el.play().catch(() => undefined);
              }
              setResume(null);
            }}
            className="glass absolute bottom-36 left-1/2 z-40 -translate-x-1/2 rounded-pill px-4 py-2 font-mono text-[11px] text-tprimary"
          >
            {t("player.resume", { time: clock(resume.positionMs / 1000) })}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ---------- codec / load failure card ---------- */}
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="w-[min(440px,88vw)] rounded-viewer bg-surface-2/95 p-6 text-center shadow-[0_16px_48px_rgba(0,0,0,.5)]">
            <p className="text-[15px] text-tprimary">
              {t(error === "io" ? "player.error_io_title" : "player.error_title")}
            </p>
            <p className="mt-2 font-mono text-[11px] text-ttertiary">
              {t(error === "io" ? "player.error_io_hint" : "player.error_hint")}
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

      {/* ---------- side navigation: prev / next in the queue ----------
          same slide contract as the other chrome (transform only, no opacity —
          the buttons carry backdrop-blur) */}
      <AnimatePresence>
        {showChrome && !error && (
          <motion.div
            key="nav-prev"
            initial={reduced ? false : { y: "-50%", x: -12 }}
            animate={{ y: "-50%", x: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "-50%", x: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="absolute left-4 top-1/2 z-40"
          >
            <button
              type="button"
              aria-label={t("viewer.prev")}
              title={t("viewer.prev")}
              disabled={!canPrev}
              onClick={() => useViewer.getState().step(-1)}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-pill bg-white/[.06] text-tprimary backdrop-blur-sm transition-all duration-[160ms] hover:bg-white/[.12]",
                !canPrev && "pointer-events-none opacity-30",
              )}
            >
              <ChevronLeft size={22} />
            </button>
          </motion.div>
        )}
        {showChrome && !error && (
          <motion.div
            key="nav-next"
            initial={reduced ? false : { y: "-50%", x: 12 }}
            animate={{ y: "-50%", x: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "-50%", x: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="absolute right-4 top-1/2 z-40"
          >
            <button
              type="button"
              aria-label={t("viewer.next")}
              title={t("viewer.next")}
              disabled={!canNext}
              onClick={() => useViewer.getState().step(1)}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-pill bg-white/[.06] text-tprimary backdrop-blur-sm transition-all duration-[160ms] hover:bg-white/[.12]",
                !canNext && "pointer-events-none opacity-30",
              )}
            >
              <ChevronRight size={22} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- right rail: up next (collapsible) ---------- */}
      <AnimatePresence>
        {stripOpen && !manualHide && queue.length > 1 && (
          <motion.aside
            initial={reduced ? false : { x: 20 }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: 20 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="glass absolute bottom-3 right-3 top-3 z-40 flex w-[144px] flex-col rounded-viewer p-2"
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
            initial={reduced ? false : { y: 16 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="absolute bottom-24 left-0 z-40 transition-[right] duration-[180ms] ease-out"
            style={{ right: stripOpen ? 156 : 0 }}
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
                src={src || undefined}
                crossOrigin="anonymous"
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <p className="timecode mt-1 text-center text-[10px] text-tsecondary">
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
            const el = vrVideo.current ?? video.current;
            if (el && duration) el.currentTime = ratio * duration;
            poke();
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            pushScrub({ x: e.clientX - rect.left, time: ratio * duration });
            if (scrubbing.current) {
              const el = vrVideo.current ?? video.current;
              if (el && duration) el.currentTime = ratio * duration;
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
        <div className="mx-6 mt-1 flex items-center justify-between text-[11px] text-ttertiary">
          <span className="timecode">{clock(current)}</span>
          <span className="timecode">{clock(duration)}</span>
        </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- ONE floating glass control pill ---------- */}
      <AnimatePresence>
        {showChrome && (
          <motion.div
            initial={reduced ? false : { y: 16 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: 16 }}
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
            {/* P1 — COLOR SHEET: a standalone glass sheet anchored directly
                ABOVE the pill, the same width as the pill (capped at 420) and
                the same material as it (glass = white 5% + blur(28) saturate
                1.2 + inner highlight), radius 20. Opening it CLOSES the
                overflow menu, so two surfaces can never overlap. */}
            <AnimatePresence>
              {colorOpen && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                  transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
                  className="glass absolute inset-x-0 bottom-[80px] z-50 mx-auto max-w-[420px] rounded-[20px] shadow-[0_16px_48px_rgba(0,0,0,.5)] outline outline-1 outline-white/[.08]"
                >
                  <ColorSheet onClose={() => setColorOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>

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
                      initial={reduced ? false : { y: 8 }}
                      animate={{ y: 0 }}
                      exit={reduced ? { opacity: 0 } : { y: 8 }}
                      transition={{ type: "spring", stiffness: 260, damping: 26 }}
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
                          const el = vrVideo.current ?? video.current;
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


              {/* VR immersion: compact mono chip, only for recognised SBS/VR
                  sources; accent tint marks the active state */}
              {isVrSource && (
                <NavTooltip label={t("player.vr")} side="top" mono>
                  <button
                    type="button"
                    aria-label={t("player.vr")}
                    aria-pressed={vrMode}
                    onClick={() => {
                      if (vrMode) {
                        exitVr();
                        return;
                      }
                      const main = video.current;
                      wasPlayingBeforeVr.current = !!main && !main.paused;
                      main?.pause();
                      setVrMode(true);
                    }}
                    className={cn(
                      "flex h-10 items-center rounded-pill px-3 font-mono text-[11px] tracking-[0.08em] transition-all duration-[160ms] ease-out active:scale-[.97]",
                      vrMode
                        ? "bg-accent/[.16] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
                        : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
                    )}
                  >
                    VR
                  </button>
                </NavTooltip>
              )}
              {isVrSource && vrMode && (
                <IconBtn
                  label={t("player.vr_eye")}
                  onClick={() => setVrEye((v) => (v === 0 ? 1 : 0))}
                >
                  <FlipHorizontal size={18} />
                </IconBtn>
              )}
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

              {/* P7 F3: the rightmost "…" — the pill stays lean, everything
                  occasional lives in one popover. F2: the menu itself renders
                  through a PORTAL (see the bottom of this component): a blur
                  surface NESTED in the glass pill sampled the pill's backdrop
                  root, not the video — the frosting vanished */}
              <span className="relative inline-flex" data-overflow-root ref={moreAnchorRef}>
                <IconBtn
                  label={t("player.more")}
                  active={overflowOpen}
                  onClick={toggleOverflow}
                >
                  <MoreHorizontal size={18} />
                </IconBtn>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- mono info panel (same contract as the lightbox) ---------- */}
      <AnimatePresence>
        {infoOpen && (
          <motion.aside
            initial={reduced ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
            className="glass absolute left-4 top-20 z-40 w-[320px] rounded-viewer p-4 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
          >
            <dl className="flex flex-col gap-2 font-mono text-[11px]">
              {[
                [t("viewer.info_path"), row.path],
                [
                  t("viewer.info_res"),
                  (row.width && row.height) || (nat.w && nat.h)
                    ? `${row.width || nat.w}×${row.height || nat.h}`
                    : "—",
                ],
                [t("viewer.info_size"), formatBytes(row.size)],
                [t("viewer.info_date"), new Date(row.mtime).toLocaleString()],
                [t("viewer.info_ext"), row.ext.toUpperCase()],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-24 shrink-0 uppercase tracking-[0.08em] text-ttertiary">
                    {label}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 flex-1 break-all text-tsecondary",
                      // raw file paths stay JetBrains Mono (.timecode, v2.4)
                      label === t("viewer.info_path") && "timecode",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ---------- F2: overflow menu — PORTAL to <body> ---------- */}
      {createPortal(
        <AnimatePresence>
          {overflowOpen && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: reduced ? 0 : 0.14, ease: "easeOut" }}
              role="menu"
              aria-label={t("player.more")}
              /* fixed to the VIEWPORT (the portal has no transformed
                 ancestors) and anchored above the "…" button */
              data-overflow-root
              className="fixed z-[130] w-[252px] overflow-hidden rounded-[20px] p-1.5"
              style={{
                left: overflowPos.left,
                bottom: overflowPos.bottom,
                /* dark-glass v2.3 recipe (the ContextMenu material) — now it
                   actually frosts, because it is not nested in the pill's
                   backdrop root any more */
                background:
                  "linear-gradient(180deg, rgba(14,14,18,.68), rgba(14,14,18,.55))",
                backdropFilter: "blur(28px) saturate(1.4)",
                WebkitBackdropFilter: "blur(28px) saturate(1.4)",
                border: "1px solid rgba(255,255,255,.08)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.06), 0 16px 48px rgba(0,0,0,.55)",
              }}
            >
              {/* snapshot needs canvas-clean frames — only the opt-in media
                  server provides them; asset frames are tainted */}
              {srcClean && (
                <OverflowItem
                  icon={<Camera size={15} />}
                  label={t("player.snapshot_clipboard")}
                  onClick={() => {
                    setOverflowOpen(false);
                    void onSnapshot();
                  }}
                />
              )}
              <OverflowItem
                icon={<ExternalLink size={15} />}
                label={t("player.open_external")}
                onClick={() => {
                  setOverflowOpen(false);
                  void invoke("open_external", { path: row.path }).catch(() =>
                    toast.error(t("errors.action_failed")),
                  );
                }}
              />
              {/* F5: the OS-painted browser PiP is replaced by a frameless
                  always-on-top child window; the main player pauses and
                  resumes at the handed-back time */}
              <OverflowItem
                icon={<PictureInPicture2 size={15} />}
                label={t("player.mini_open")}
                onClick={() => {
                  setOverflowOpen(false);
                  const el = vrVideo.current ?? video.current;
                  const positionMs = el ? Math.round(el.currentTime * 1000) : 0;
                  el?.pause();
                  void invoke("open_mini_player", {
                    payload: { row, positionMs },
                  }).catch((e) => {
                    console.error("open_mini_player failed", e);
                    toast.error(t("errors.action_failed"));
                  });
                }}
              />
              {/* P1: the sheet lives OUTSIDE this menu — opening it closes the
                  menu instead of stacking two surfaces */}
              <OverflowItem
                icon={<Palette size={15} />}
                label={t("player.color")}
                active={colorOpen}
                onClick={() => {
                  setOverflowOpen(false);
                  setColorOpen((o) => !o);
                }}
              />
              {/* loop stays open so the check state is visible live */}
              <OverflowItem
                icon={<Repeat size={15} />}
                label={t("player.loop")}
                active={loop}
                onClick={() => {
                  const el = vrVideo.current ?? video.current;
                  const next = !loop;
                  setLoop(next);
                  if (el) el.loop = next;
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/**
 * P1 — COLOR CORRECTION SHEET. Two global filters written through the settings
 * store; the CSS var updates live, so the picture changes while you drag.
 *
 * The sheet is the PILL'S OWN MATERIAL (glass: white 5% + blur(28) saturate
 * 1.2 + inner top highlight), radius 20, width-matched to the pill and capped
 * at 420 — it reads as the pill unfolding upward rather than a foreign panel.
 * It can never overlap the overflow menu either: opening it closes the menu.
 * Sliders run the glass variant of the shared Slider (white/14 track, accent
 * fill with a soft glow, 18px white thumb), with a mono value chip and a detent
 * at the neutral point.
 * It is rendered ABOVE the pill so the pill stays visible and clickable — the
 * user adjusts the filters while the video is playing.
 */
function ColorSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const saturation = useAppSettings((s) => s.videoSaturation);
  const sharpness = useAppSettings((s) => s.videoSharpness);
  const setSaturation = useAppSettings((s) => s.setVideoSaturation);
  const setSharpness = useAppSettings((s) => s.setVideoSharpness);
  const dirty = saturation !== 1 || sharpness !== 0;

  return (
    <div role="group" aria-label={t("player.color")} className="px-4 pb-3 pt-4">
      <header className="mb-5 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-tprimary">
          <Palette size={14} className="text-accent" />
          {t("player.color")}
        </h3>
        <button
          type="button"
          aria-label={t("viewer.close")}
          title={t("viewer.close")}
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-control text-tsecondary transition-colors duration-[120ms] hover:bg-white/[.10] hover:text-tprimary"
        >
          <X size={15} />
        </button>
      </header>

      {/* saturation: 100% is the neutral point, so the track carries a detent */}
      <FilterSlider
        icon={<Droplet size={14} />}
        label={t("player.color_saturation")}
        value={Math.round(saturation * 100)}
        min={50}
        max={200}
        step={5}
        suffix="%"
        mark={((100 - 50) / (200 - 50)) * 100}
        onChange={(pct) => void setSaturation(pct / 100)}
      />
      <FilterSlider
        icon={<Sparkles size={14} />}
        label={t("player.color_sharpness")}
        value={Math.round(sharpness * 100)}
        min={0}
        max={100}
        step={5}
        suffix="%"
        mark={0}
        onChange={(pct) => void setSharpness(pct / 100)}
      />

      {/* editorial hairline divider (DESIGN §1: the only place borders live) */}
      <div className="my-4 h-px bg-white/[.08]" />

      <button
        type="button"
        disabled={!dirty}
        onClick={() => {
          void setSaturation(1);
          void setSharpness(0);
        }}
        className={cn(
          "flex h-10 w-full items-center justify-center gap-2 rounded-control text-[13px] transition-colors duration-[120ms]",
          dirty
            ? "text-tsecondary hover:bg-white/[.10] hover:text-tprimary"
            : "cursor-default text-white/25",
        )}
      >
        <RotateCcw size={14} />
        {t("player.color_reset")}
      </button>
    </div>
  );
}

function FilterSlider({
  icon,
  label,
  value,
  min,
  max,
  step,
  suffix,
  mark,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  mark?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-5 block last:mb-0">
      <span className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[12px] text-tsecondary">
          <span className="text-ttertiary">{icon}</span>
          {label}
        </span>
        {/* mono value chip (DESIGN §7/§10 Slider) — tabular figures, never a
            jumping label while the thumb is dragged */}
        <span className="rounded-[9px] bg-white/[.08] px-2 py-[3px] font-mono text-[10.5px] tabular-nums text-tprimary">
          {value}
          {suffix}
        </span>
      </span>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        mark={mark}
        variant="glass"
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}

function OverflowItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13px] transition-colors duration-[120ms]",
        active
          ? "bg-white/[.10] text-tprimary"
          : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-80">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
    </button>
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
