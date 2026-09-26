import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAppSettings,
  type ProfilerCorner,
} from "@/lib/settings";
import { usePerf } from "@/lib/perf";
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
  const [heap, setHeap] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      const mem = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      if (mem) setHeap({ used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit });
    }, 1000);
    return () => window.clearInterval(id);
  }, [on]);

  const findings = useDiagnostics(fps, worstMs, longTasks, blockedMs, heap, t);

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
