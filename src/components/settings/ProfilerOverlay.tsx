import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAppSettings,
  type ProfilerCorner,
} from "@/lib/settings";
import {
  perfEvents,
  perfHistory,
  PERF_HISTORY_CAP,
  usePerf,
  type HistoryEvent,
} from "@/lib/perf";
import { cn } from "@/lib/utils";

/**
 * In-viewport profiler overlay — DEVELOPER ONLY.
 *
 * Mounted app-wide when `dev_profiler` is on (Settings › Developer, itself
 * hidden behind the About-logo easter egg). Publishes, live:
 *  - FPS + worst frame delta from the rAF watchdog (`usePerf`, already running);
 *  - long tasks (>300ms) and total blocked time from the same store;
 *  - JS heap usage from `performance.memory` (Chromium/WebView2), sampled 1×/s;
 *  - an AUTOMATIC DIAGNOSIS block: thresholds turn the raw counters into plain
 *    sentences ("UI drops frames", "heap is large") with a hint each — a
 *    screenshot of the overlay IS the performance report.
 *
 * Docks to any viewport corner (`dev_profiler_corner`, picker in Settings ›
 * Developer). Rendered on TOP of everything, pointer-events: none, so it never
 * blocks the UI it measures. The overlay itself must stay cheap: one 1 Hz
 * interval for the heap, the store subscription for the rest — no rAF of its
 * own, so the meter cannot cause the stutter it is measuring.
 */

const CORNER_CLASS: Record<ProfilerCorner, string> = {
  tl: "top-3 left-3",
  tr: "top-3 right-3",
  bl: "bottom-3 left-3",
  br: "bottom-3 right-3",
};

function formatMb(bytes: number | undefined) {
  if (!bytes) return "—";
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * FPS sparkline — a 1 Hz snapshot of the ring buffer in one SVG polyline.
 * 60 fps sits at 3/4 height; the line CLIPS at the top rather than squashing,
 * so a healthy run and a stuttered run look different at a glance. Renders
 * from the shared buffers directly (no react state per point), re-drawn on
 * the component's 1 Hz tick + a rAF-aligned tick while the tab is visible.
 */
const SPARK_W = 224;
const SPARK_H = 34;

function Sparkline({ tick, label }: { tick: number; label: string }) {
  // `tick` is a render nonce: the parent bumps it 1×/s so the polyline tracks
  // the moving ring buffer. perfHistory is read directly on each render.
  void tick;
  const n = perfHistory.length;
  const step = SPARK_W / Math.max(1, PERF_HISTORY_CAP - 1);
  const left = (PERF_HISTORY_CAP - n) * step; // partial window starts at the left
  const pts = perfHistory
    .map((p, i) => {
      const x = left + i * step;
      const y = SPARK_H - (Math.min(p.fps, 80) / 80) * (SPARK_H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="px-3 pb-2">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">{label}</span>
        <span className="text-white/30">0–80</span>
      </div>
      <svg
        aria-hidden
        width="100%"
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="block"
      >
        {/* 60 fps guide line — the eye needs a reference to read "fine" vs "slow" */}
        <line
          x1={0}
          x2={SPARK_W}
          y1={SPARK_H - (60 / 80) * (SPARK_H - 2) - 1}
          y2={SPARK_H - (60 / 80) * (SPARK_H - 2) - 1}
          stroke="rgba(255,255,255,.12)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        {n > 1 && <polyline points={pts} fill="none" stroke="#6ee7b7" strokeWidth={1.4} />}
      </svg>
    </div>
  );
}

/**
 * Event strip — load / seek / stall markers under the sparkline, positioned by
 * their ring index. Read left = old, right = now; hovering is not needed, the
 * counts live in the VIDEO block above.
 */
function EventStrip({ tick }: { tick: number }) {
  void tick;
  const n = perfHistory.length;
  if (n === 0) return null;
  const step = SPARK_W / Math.max(1, PERF_HISTORY_CAP - 1);
  const left = (PERF_HISTORY_CAP - n) * step;
  const cut = perfEvents.length > PERF_HISTORY_CAP ? perfEvents.length - PERF_HISTORY_CAP : 0;
  const visible = perfEvents.slice(cut);
  const color: Record<HistoryEvent["kind"], string> = {
    load: "bg-sky-300",
    seek: "bg-violet-300",
    stall: "bg-amber-300",
  };
  return (
    <div aria-hidden className="relative mx-3 mb-2 h-1.5 rounded-pill bg-white/[.06]">
      {visible.map((e, i) => (
        <span
          key={`${e.at}-${e.kind}-${i}`}
          className={cn("absolute top-1/2 h-1.5 w-[3px] -translate-y-1/2 rounded-pill", color[e.kind])}
          style={{ left: `${left + e.at * step}px` }}
        />
      ))}
    </div>
  );
}

/** One plain-language finding of the auto-diagnostics. */
interface Finding {
  /** severity picks the dot + text color */
  level: "warn" | "info" | "ok";
  text: string;
}

/**
 * The diagnostics live in the component (not the store) so they always read
 * the SAME window the meters show. Thresholds are deliberately generous: the
 * panel exists to answer "is something wrong right now", not to nitpick.
 */
function useDiagnostics(
  fps: number,
  worstMs: number,
  longTasks: number,
  blockedMs: number,
  heap: { used: number; limit: number } | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Finding[] {
  return useMemo(() => {
    const out: Finding[] = [];
    if (fps > 0 && fps < 40) {
      out.push({ level: "warn", text: t("profiler.diag_low_fps", { fps }) });
    } else if (worstMs > 250) {
      out.push({ level: "warn", text: t("profiler.diag_frame_hitch", { ms: Math.round(worstMs) }) });
    } else if (fps >= 55) {
      out.push({ level: "ok", text: t("profiler.diag_ok_render") });
    }
    if (blockedMs > 2_000) {
      out.push({ level: "warn", text: t("profiler.diag_blocked", { ms: Math.round(blockedMs) }) });
    }
    if (longTasks >= 3) {
      out.push({ level: "warn", text: t("profiler.diag_long_tasks", { count: longTasks }) });
    }
    if (heap && heap.used > 900 * 1024 * 1024) {
      out.push({ level: "warn", text: t("profiler.diag_heap", { mb: Math.round(heap.used / 1024 / 1024) }) });
    }
    if (out.every((f) => f.level === "ok")) {
      out.push({ level: "ok", text: t("profiler.diag_all_ok") });
    }
    return out;
  }, [fps, worstMs, longTasks, blockedMs, heap, t]);
}

export function ProfilerOverlay() {
  const { t } = useTranslation();
  const on = useAppSettings((s) => s.profiler);
  const corner = useAppSettings((s) => s.profilerCorner);
  const fps = usePerf((s) => s.fps);
  const worstMs = usePerf((s) => s.worstMs);
  const longTasks = usePerf((s) => s.longTasks);
  const longestMs = usePerf((s) => s.longestMs);
  const blockedMs = usePerf((s) => s.blockedMs);
  const videoLoadMs = usePerf((s) => s.videoLoadMs);
  const videoSeekMs = usePerf((s) => s.videoSeekMs);
  const videoSeeks = usePerf((s) => s.videoSeeks);
  const videoWorstSeekMs = usePerf((s) => s.videoWorstSeekMs);
  const videoBufferingMs = usePerf((s) => s.videoBufferingMs);
  const [heap, setHeap] = useState<{ used: number; limit: number } | null>(null);
  /** render nonce for the sparkline: history lives outside the store, so the
   *  overlay needs its own cadence to redraw the moving ring buffer */
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      const mem = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      if (mem) setHeap({ used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit });
      tickRef.current += 1;
      setTick(tickRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [on]);

  const findings = useDiagnostics(fps, worstMs, longTasks, blockedMs, heap, t);
  // video findings only when a video has actually been opened this session
  if (videoSeekMs !== null && videoSeekMs > 800) {
    findings.push({ level: "warn", text: t("profiler.diag_slow_seek", { ms: videoSeekMs }) });
  }
  if (videoLoadMs !== null && videoLoadMs > 2_000) {
    findings.push({ level: "warn", text: t("profiler.diag_slow_video", { ms: videoLoadMs }) });
  }

  if (!on) return null;

  const heapPct = heap ? Math.round((heap.used / heap.limit) * 100) : null;
  const problems = findings.filter((f) => f.level === "warn");

  return (
    <div
      role="status"
      aria-label="profiler"
      className={cn(
        "pointer-events-none fixed z-[999] w-[248px] select-none overflow-hidden rounded-[14px]",
        "border border-white/[.10] bg-black/80 font-mono text-[10px] leading-[1.65] text-white/85",
        "shadow-[0_10px_32px_rgba(0,0,0,.55)] backdrop-blur-[8px]",
        CORNER_CLASS[corner],
      )}
    >
      {/* header: title + severity dot (accent when clean, amber when not) */}
      <div className="flex items-center gap-2 border-b border-white/[.08] px-3 py-2">
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-pill",
            problems.length > 0 ? "bg-amber-300" : "bg-emerald-400",
          )}
        />
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/50">
          LUMEN profiler
        </span>
        <span className="ml-auto tabular-nums">
          <span className={fps < 45 ? "text-amber-300" : "text-emerald-300"}>{fps}</span>
          <span className="text-white/45"> fps</span>
        </span>
      </div>

      {/* the raw meters */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 px-3 py-2">
        <span className="text-white/45">worst</span>
        <span className="tabular-nums">{Math.round(worstMs)} ms</span>
        <span className="text-white/45">long tasks</span>
        <span className="tabular-nums">
          {longTasks}
          <span className="text-white/45"> · longest {longestMs} ms</span>
        </span>
        <span className="text-white/45">blocked</span>
        <span className="tabular-nums">{blockedMs} ms</span>
        <span className="text-white/45">heap</span>
        <span className="tabular-nums">
          {formatMb(heap?.used)}
          {heapPct !== null && <span className="text-white/45"> · {heapPct}%</span>}
        </span>
      </div>

      {/* history: FPS sparkline + video event markers (ring buffer, 30 s) */}
      <Sparkline tick={tick} label={t("profiler.history")} />
      <EventStrip tick={tick} />

      {/* VIDEO pipeline — visible after the first video of the session; answers
          "why does it think after a seek": load = source→first frame, seek =
          request→frame painted, buffering = total time starved for bytes */}
      {(videoLoadMs !== null || videoSeeks > 0) && (
        <div className="border-t border-white/[.08] px-3 py-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-white/40">
            {t("profiler.video")}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3">
            <span className="text-white/45">load</span>
            <span className="tabular-nums">
              {videoLoadMs !== null ? `${videoLoadMs} ms` : "…"}
            </span>
            <span className="text-white/45">last seek</span>
            <span
              className={cn(
                "tabular-nums",
                videoSeekMs !== null && videoSeekMs > 800 && "text-amber-300",
              )}
            >
              {videoSeekMs !== null ? `${videoSeekMs} ms` : "—"}
            </span>
            <span className="text-white/45">seeks</span>
            <span className="tabular-nums">
              {videoSeeks}
              <span className="text-white/45"> · worst {videoWorstSeekMs} ms</span>
            </span>
            <span className="text-white/45">buffering</span>
            <span className="tabular-nums">{videoBufferingMs} ms</span>
          </div>
        </div>
      )}

      {/* auto-diagnostics: plain sentences, one per finding */}
      <div className="border-t border-white/[.08] px-3 py-2">
        <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-white/40">
          {t("profiler.diagnostics")}
        </div>
        <ul className="space-y-1">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-1.5 leading-snug">
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] h-1 w-1 shrink-0 rounded-pill",
                  f.level === "warn" ? "bg-amber-300" : "bg-emerald-400",
                )}
              />
              <span className={f.level === "warn" ? "text-amber-200/90" : "text-white/60"}>
                {f.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
