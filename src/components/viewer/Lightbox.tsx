import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Heart,
  Info,
  Maximize2,
  PanelBottom,
  RotateCw,
  Scan,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { formatBytes, type MediaRow } from "@/lib/api";
import { baseName, formatResolution } from "@/lib/format";
import { trashMedia } from "@/lib/mediaActions";
import { useViewer } from "@/state/viewer";
import { useAppSettings } from "@/lib/settings";
import { thumbSrc, useThumbStore } from "@/lib/thumbs";
import { Filmstrip } from "./Filmstrip";

/** relative to the fit size: 1 = contain, MAX = deep zoom */
const MAX_ZOOM = 12;
const MIN_ZOOM = 1;
/** height of the open filmstrip block — the control pill floats above it */
const STRIP_H = 150;

interface Fit {
  w: number;
  h: number;
  /** fit multiplier: rendered = natural * fitScale * zoom */
  scale: number;
}

/**
 * Photo lightbox (STEP 1).
 *
 * Pure black stage, contain-fit image, subtle vignette; crossfade + slight scale
 * between items (180ms). Zoom is modelled RELATIVE TO FIT: `zoom === 1` is
 * contain, `zoom === 1 / fit.scale` is 1:1 (natural pixels), so the wheel never
 * depends on the file's resolution. Wheel zooms towards the cursor, dragging pans
 * only while zoomed, dblclick toggles 1:1 ↔ fit.
 */
export function Lightbox({ row }: { row: MediaRow }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** the wheel handler reads THIS, never a value captured by a render */
  const zoomRef = useRef(1);
  const commitZoom = useCallback((z: number) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  /** deep-zoom drag: a pointermove storm forces re-raster of the huge scaled
      layer — coalesce to ONE setState per frame (the wheel path already does) */
  const panRaf = useRef(0);
  const panTarget = useRef<{ x: number; y: number } | null>(null);
  /** offset of the in-flight swipe (px) — feedback while the finger moves */
  const [swipeDx, setSwipeDx] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeNavigate = useAppSettings((s) => s.swipeNavigate);
  const pillAlign = useAppSettings((s) => s.pillAlign);

  const infoOpen = useViewer((s) => s.infoOpen);
  const stripOpen = useViewer((s) => s.stripOpen);
  const toggleInfo = useViewer((s) => s.toggleInfo);
  const toggleStrip = useViewer((s) => s.toggleStrip);
  const favoriteOf = useViewer((s) => s.favoriteOf);
  const toggleFavorite = useViewer((s) => s.toggleFavorite);
  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);

  /**
   * STAGED DECODE (P0-0c). The stage used to wait for the FULL-RESOLUTION decode
   * of every file, so arrowing through a cold queue showed black for as long as
   * the original took — worse while thumbnails were generating. The cached 480w
   * thumbnail now paints immediately underneath and the original fades in over
   * it. The live thumb-store value wins over the DB column (a thumb produced
   * this session is already on disk).
   */
  const underlaySrc = useThumbStore((s) => s.thumbs[row.id]?.path ?? row.thumbPath);

  const rotated = Math.abs(rotate % 180) === 90;

  // stage size (kept in state so fit can be recomputed on window resize)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () =>
      setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit: Fit = useMemo(() => {
    const nw = rotated ? natural.h : natural.w;
    const nh = rotated ? natural.w : natural.h;
    if (!nw || !nh || !stage.w || !stage.h) return { w: 0, h: 0, scale: 1 };
    const scale = Math.min(stage.w / nw, stage.h / nh);
    return { w: nw * scale, h: nh * scale, scale };
  }, [natural, stage, rotated]);

  // every item starts contained, unrotated
  useEffect(() => {
    commitZoom(1);
    setPan({ x: 0, y: 0 });
    setRotate(0);
    setLoaded(false);
    setFailed(false);
    setNatural({ w: 0, h: 0 });
  }, [row.id, commitZoom]);

  /**
   * Neighbour prefetch — THUMBS ONLY (P0-0c). Pre-decoding the next original is
   * what made paging hitch: two full-size decodes compete with the one the user
   * is looking at. A 480w webp is a few KB, already on disk, and is exactly what
   * the underlay needs on the next arrow press.
   */
  useEffect(() => {
    if (!tauriAvailable()) return;
    const pre: HTMLImageElement[] = [];
    for (const d of [-1, 1]) {
      const n = queue[index + d];
      if (!n) continue;
      const p = useThumbStore.getState().thumbs[n.id]?.path ?? n.thumbPath;
      if (!p) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = thumbSrc(p);
      pre.push(img);
    }
    return () => {
      for (const img of pre) img.src = "";
    };
  }, [queue, index]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      // contain-fit means the picture is centred at z = 1 — keep it there
      if (z <= 1.001) return { x: 0, y: 0 };
      // Edge-lock when the zoomed picture exceeds the stage; ROAM range when
      // it is still smaller — otherwise a photo at 110–130% was nailed to the
      // centre ("pan refuses to move until I reset to 100% and zoom again")
      const overW = Math.abs(fit.w * z - stage.w) / 2;
      const overH = Math.abs(fit.h * z - stage.h) / 2;
      return {
        x: Math.min(overW, Math.max(-overW, x)),
        y: Math.min(overH, Math.max(-overH, y)),
      };
    },
    [fit.w, fit.h, stage.w, stage.h],
  );

  const applyZoom = useCallback(
    (next: number, cursor?: { x: number; y: number }) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const prev = zoomRef.current;
      commitZoom(z);
      setPan((p) => {
        if (!cursor) return clampPan(p.x, p.y, z);
        // keep the point under the cursor fixed while the image scales
        const k = z / prev;
        const x = cursor.x - k * (cursor.x - p.x);
        const y = cursor.y - k * (cursor.y - p.y);
        return clampPan(x, y, z);
      });
    },
    [clampPan, commitZoom],
  );

  const oneToOne = fit.scale > 0 ? 1 / fit.scale : 1;

  // Wheel = zoom towards the cursor (STEP 1 contract). Attached NATIVELY with
  // `passive: false`: React's synthetic wheel listener is passive, so calling
  // preventDefault there only logged "Unable to preventDefault inside passive
  // event listener" (and let the gesture scroll the page behind the viewer).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let pending = 0;
    let cursor: { x: number; y: number } | undefined;
    let raf = 0;
    // Coalesce the gesture to ONE zoom step per frame. A trackpad emits dozens
    // of wheel events per swipe; applying each of them re-rendered the whole
    // viewer and re-rasterised a large image several times per frame, which is
    // how a smooth scroll turned into a frozen UI.
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const steps = pending / 100;
      pending = 0;
      applyZoom(zoomRef.current * Math.pow(1.14, -steps), cursor);
    };
    const onWheel = (e: WheelEvent) => {
      if (failed || !loaded) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      cursor = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      pending += e.deltaY;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [applyZoom, failed, loaded]);

  useEffect(
    () => () => {
      if (panRaf.current) cancelAnimationFrame(panRaf.current);
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (failed) return;
    // read the LIVE zoom from the ref — the wheel path commits through rAF, so
    // a state read here could still see the pre-zoom value and route the
    // gesture into the swipe branch (pan dead until reset to fit)
    if (zoomRef.current > MIN_ZOOM) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      setDragging(true);
      return;
    }
    // contained image: a horizontal drag walks the queue (mouse, touchpad and
    // touch alike). Settings › Appearance can switch the gesture off.
    if (!swipeNavigate) return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      panTarget.current = {
        x: d.px + (e.clientX - d.x),
        y: d.py + (e.clientY - d.y),
      };
      if (!panRaf.current) {
        panRaf.current = requestAnimationFrame(() => {
          panRaf.current = 0;
          const t = panTarget.current;
          if (t) setPan(clampPan(t.x, t.y, zoomRef.current));
        });
      }
      return;
    }
    const s = swipeStart.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // only claim the gesture once it is clearly horizontal, so selecting text or
    // a vertical wobble never drags the photo sideways
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) setSwipeDx(dx);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
    swipeStart.current = null;
    // a quarter of the stage (or a decisive flick) turns the page
    const dx = swipeDx;
    if (dx === 0) return;
    setSwipeDx(0);
    if (Math.abs(dx) > Math.min(140, Math.max(60, stage.w * 0.14))) {
      useViewer.getState().step(dx < 0 ? 1 : -1);
    }
  };

  // keys: arrows nav, Esc close, F favorite, I info, 0 fit, 1 1:1
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = useViewer.getState();
      if (e.key === "Escape") {
        e.preventDefault();
        v.close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        v.step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        v.step(-1);
      } else if (e.key === "f" || e.key === "F") {
        v.toggleFavorite(row);
      } else if (e.key === "i" || e.key === "I") {
        v.toggleInfo();
      } else if (e.key === "0") {
        commitZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === "1") {
        commitZoom(oneToOne);
        setPan((p) => clampPan(p.x, p.y, oneToOne));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, oneToOne, clampPan, commitZoom]);

  const name = baseName(row.path);
  const fav = favoriteOf(row);
  const canPrev = index > 0;
  const canNext = index < queue.length - 1;

  const zoomPercent = Math.round(zoom * fit.scale * 100);

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* ---------- stage ---------- */}
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (reduced) return;
          if (zoom > MIN_ZOOM + 0.01) {
            commitZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            commitZoom(oneToOne);
          }
        }}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden",
          zoom > MIN_ZOOM ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        )}
      >
        {!loaded && !failed && !underlaySrc && (
          <div className="shimmer-bg absolute inset-0 opacity-60" aria-hidden />
        )}

        {/* instant underlay: the cached thumb, underneath the original */}
        {!failed && underlaySrc && (
          <img
            key={`thumb-${row.id}`}
            src={thumbSrc(underlaySrc)}
            alt=""
            aria-hidden
            draggable={false}
            className={cn(
              "pointer-events-none absolute max-h-full max-w-full select-none object-contain transition-opacity duration-200 ease-out",
              loaded ? "opacity-0" : "opacity-100",
            )}
          />
        )}

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={row.id}
            initial={reduced ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {failed ? (
              // undecodable: neutral tile + mono ext chip, never a broken glyph
              <div className="flex flex-col items-center gap-3 text-ttertiary">
                <FileWarning size={28} strokeWidth={1.5} />
                <div className="flex items-center gap-2">
                  <span className="rounded-[8px] border border-white/12 bg-white/[.04] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em]">
                    {row.ext}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                    {t("thumbs.noPreview")}
                  </span>
                </div>
              </div>
            ) : (
              <img
                // keyed by row: navigating unmounts the previous element, which
                // CANCELS its in-flight decode instead of letting a queue of
                // abandoned originals compete with the item on screen (P0-0c)
                key={row.id}
                // In the app this is the ORIGINAL file through the asset protocol.
                // The browser QA route has no such protocol, so it shows the
                // generated thumbnail instead of an unloadable path.
                src={tauriAvailable() ? fileSrc(row.path) : (row.thumbPath ? thumbSrc(row.thumbPath) : "")}
                alt={name}
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                  setLoaded(true);
                }}
                onError={() => setFailed(true)}
                className={cn(
                  "pointer-events-none select-none object-contain transition-opacity duration-[180ms] ease-out",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                style={{
                  width: fit.w || undefined,
                  height: fit.h || undefined,
                  willChange: "transform",
                  transform: `translate3d(${pan.x + swipeDx}px, ${pan.y}px, 0) scale(${zoom}) rotate(${rotate}deg)`,
                  opacity: swipeDx ? Math.max(0.3, 1 - Math.abs(swipeDx) / 520) : 1,
                  transition:
                    dragging || reduced || swipeDx !== 0 ? "none" : "transform 120ms ease-out",
                  imageRendering: zoom * fit.scale > 2 ? "pixelated" : "auto",
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* subtle vignette (viewers only, DESIGN §5) */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 0 200px 40px rgba(0,0,0,.8)" }}
        />

        {/* side navigation */}
        <button
          type="button"
          aria-label={t("viewer.prev")}
          title={t("viewer.prev")}
          disabled={!canPrev}
          onClick={() => useViewer.getState().step(-1)}
          className={cn(
            "absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-pill bg-white/[.06] text-tprimary backdrop-blur-sm transition-all duration-[160ms] hover:bg-white/[.12]",
            !canPrev && "pointer-events-none opacity-30",
          )}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          aria-label={t("viewer.next")}
          title={t("viewer.next")}
          disabled={!canNext}
          onClick={() => useViewer.getState().step(1)}
          className={cn(
            "absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-pill bg-white/[.06] text-tprimary backdrop-blur-sm transition-all duration-[160ms] hover:bg-white/[.12]",
            !canNext && "pointer-events-none opacity-30",
          )}
        >
          <ChevronRight size={22} />
        </button>

        {/* top-left name chip — the media name stays LEFT, never centred */}
        <div className="glass pointer-events-none absolute left-4 top-4 z-40 flex h-10 max-w-[62vw] items-center gap-3 rounded-pill px-4">
          <span className="truncate text-[13px] text-tprimary">{name}</span>
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ttertiary">
            {index + 1} / {queue.length}
          </span>
        </div>

        {/* close */}
        <button
          type="button"
          aria-label={t("viewer.close")}
          title={t("viewer.close")}
          onClick={() => useViewer.getState().close()}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-pill bg-white/[.06] text-tprimary transition-colors duration-[160ms] hover:bg-white/[.12]"
        >
          <X size={18} />
        </button>

        {/* ---------- mono info panel ---------- */}
        <AnimatePresence>
          {infoOpen && (
            <motion.aside
              initial={reduced ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
              transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
              className="absolute right-4 top-16 w-[320px] rounded-viewer bg-surface-2/95 p-4 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
            >
              <dl className="flex flex-col gap-2 text-[11px] leading-relaxed">
                {[
                  [t("viewer.info_path"), row.path],
                  [
                    t("viewer.info_res"),
                    formatResolution(row.width, row.height) ?? "—",
                  ],
                  [t("viewer.info_size"), formatBytes(row.size)],
                  [
                    t("viewer.info_date"),
                    new Date(row.mtime).toLocaleString("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  ],
                  [t("viewer.info_ext"), row.ext.toUpperCase()],
                  [t("viewer.info_zoom"), `${zoomPercent}%`],
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
      </div>

      {/* ---------- collapsible filmstrip ---------- */}
      <AnimatePresence initial={false}>
        {stripOpen && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: STRIP_H, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="shrink-0 overflow-hidden"
          >
            <div className="glass mx-auto mb-3 w-[min(1100px,92vw)] rounded-viewer px-3 py-2">
              {/* the name sits LEFT above its own queue (never centred) */}
              <div className="mb-2 flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-tprimary">
                  {name}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ttertiary">
                  {index + 1} / {queue.length}
                </span>
              </div>
              <Filmstrip height={96} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- floating glass control pill ---------- */}
      {/* the strip is part of the layout, so the pill lifts ABOVE it — the old
          fixed bottom-5 sat right on top of the filmstrip */}
      <div
        className={cn(
          "pointer-events-none absolute z-40 transition-[bottom] duration-[180ms] ease-out",
          // Settings › Appearance: the pill can sit centre, left or right
          pillAlign === "left" && "left-6",
          pillAlign === "right" && "right-6",
          pillAlign === "center" && "left-1/2 -translate-x-1/2",
        )}
        style={{ bottom: stripOpen ? STRIP_H + 16 : 20 }}
      >
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="glass pointer-events-auto flex h-14 items-center gap-1 rounded-pill px-2"
          role="toolbar"
          aria-label={t("viewer.controls")}
        >
          <PillButton
            label={t("viewer.fit")}
            active={Math.abs(zoom - 1) < 0.01}
            onClick={() => {
              commitZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Scan size={17} />
          </PillButton>
          <PillButton
            label={t("viewer.actual")}
            active={Math.abs(zoom - oneToOne) < 0.01 && oneToOne > 1}
            onClick={() => {
              commitZoom(oneToOne);
              setPan((p) => clampPan(p.x, p.y, oneToOne));
            }}
          >
            <Maximize2 size={17} />
          </PillButton>

          <input
            type="range"
            min={100}
            max={600}
            step={5}
            value={Math.min(600, Math.max(100, zoomPercent))}
            onChange={(e) => applyZoom(Number(e.target.value) / 100 / fit.scale)}
            aria-label={t("viewer.zoom")}
            className="mx-2 h-1 w-32 cursor-pointer appearance-none rounded-pill bg-white/15 accent-accent"
          />
          <span className="mr-2 w-14 shrink-0 font-mono text-[11px] text-ttertiary">
            {zoomPercent}%
          </span>

          <PillButton
            label={t("viewer.rotate")}
            onClick={() => setRotate((r) => (r + 90) % 360)}
          >
            <RotateCw size={17} />
          </PillButton>

          <span className="mx-1 h-6 w-px bg-white/10" />

          <PillButton
            label={t("viewer.favorite")}
            active={fav}
            onClick={() => toggleFavorite(row)}
          >
            <Heart size={17} className={fav ? "fill-accent text-accent" : undefined} />
          </PillButton>
          <PillButton label={t("viewer.info")} active={infoOpen} onClick={toggleInfo}>
            <Info size={17} />
          </PillButton>
          <PillButton
            label={t("viewer.filmstrip")}
            active={stripOpen}
            onClick={toggleStrip}
          >
            <PanelBottom size={17} />
          </PillButton>
          <PillButton
            label={t("viewer.trash")}
            onClick={() => {
              void trashMedia([row.id]);
              useViewer.getState().close();
            }}
          >
            <Trash2 size={17} />
          </PillButton>
        </motion.div>
      </div>
    </div>
  );
}

/** 40px tonal icon button for the viewer pill (v2.2 control height). */
function PillButton({
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
