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
import { Filmstrip } from "./Filmstrip";

/** relative to the fit size: 1 = contain, MAX = deep zoom */
const MAX_ZOOM = 12;
const MIN_ZOOM = 1;

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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const infoOpen = useViewer((s) => s.infoOpen);
  const stripOpen = useViewer((s) => s.stripOpen);
  const toggleInfo = useViewer((s) => s.toggleInfo);
  const toggleStrip = useViewer((s) => s.toggleStrip);
  const favoriteOf = useViewer((s) => s.favoriteOf);
  const toggleFavorite = useViewer((s) => s.toggleFavorite);
  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);

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
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotate(0);
    setLoaded(false);
    setFailed(false);
    setNatural({ w: 0, h: 0 });
  }, [row.id]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const overW = Math.max(0, (fit.w * z - stage.w) / 2);
      const overH = Math.max(0, (fit.h * z - stage.h) / 2);
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
      setZoom(z);
      setPan((p) => {
        if (!cursor) return clampPan(p.x, p.y, z);
        // keep the point under the cursor fixed while the image scales
        const k = z / zoom;
        const x = cursor.x - k * (cursor.x - p.x);
        const y = cursor.y - k * (cursor.y - p.y);
        return clampPan(x, y, z);
      });
    },
    [clampPan, zoom],
  );

  const oneToOne = fit.scale > 0 ? 1 / fit.scale : 1;

  // wheel = zoom towards the cursor (STEP 1 contract)
  const onWheel = (e: React.WheelEvent) => {
    if (failed || !loaded) return;
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursor = {
      x: e.clientX - rect.left - rect.width / 2,
      y: e.clientY - rect.top - rect.height / 2,
    };
    applyZoom(zoom * (e.deltaY < 0 ? 1.14 : 1 / 1.14), cursor);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= MIN_ZOOM || failed) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPan(clampPan(d.px + (e.clientX - d.x), d.py + (e.clientY - d.y), zoom));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
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
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === "1") {
        setZoom(oneToOne);
        setPan((p) => clampPan(p.x, p.y, oneToOne));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, oneToOne, clampPan]);

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
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (reduced) return;
          if (zoom > MIN_ZOOM + 0.01) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            setZoom(oneToOne);
          }
        }}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          zoom > MIN_ZOOM ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        )}
      >
        {!loaded && !failed && (
          <div className="shimmer-bg absolute inset-0 opacity-60" aria-hidden />
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
                // In the app this is the ORIGINAL file through the asset protocol.
                // The browser QA route has no such protocol, so it shows the
                // generated thumbnail instead of an unloadable path.
                src={tauriAvailable() ? fileSrc(row.path) : (row.thumbPath ?? "")}
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
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotate(${rotate}deg)`,
                  transition: dragging || reduced ? "none" : "transform 120ms ease-out",
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
              <dl className="flex flex-col gap-2 font-mono text-[11px] leading-relaxed">
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
                    <dd className="min-w-0 flex-1 break-all text-tsecondary">{value}</dd>
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
            animate={{ height: 112, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="shrink-0 overflow-hidden"
          >
            <div className="glass mx-auto mb-3 w-[min(1100px,92vw)] rounded-viewer px-2 py-1">
              <Filmstrip />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- floating glass control pill ---------- */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
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
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Scan size={17} />
          </PillButton>
          <PillButton
            label={t("viewer.actual")}
            active={Math.abs(zoom - oneToOne) < 0.01 && oneToOne > 1}
            onClick={() => {
              setZoom(oneToOne);
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
