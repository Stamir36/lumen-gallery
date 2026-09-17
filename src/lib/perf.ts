import { create } from "zustand";

/**
 * Frame-rate + long-task watchdog.
 *
 * Two jobs:
 *
 *  1. **diagnostics.** "The whole UI froze" is a report without numbers. A
 *     Chromium `longtask` observer plus a main-thread drift probe turn it into a
 *     log line — `[perf] long task 1840ms (self)` — so the next report can say
 *     what blocked the thread instead of how it felt.
 *  2. **the honest FPS chip.** Frame rate is measured from real
 *     `requestAnimationFrame` deltas, never guessed, and published only ~4×/s so
 *     the meter itself cannot cause the stutter it is measuring.
 */
export interface PerfState {
  /** frames per second over the last sampling window */
  fps: number;
  /** worst frame delta in the window (ms) — the number that feels like a hitch */
  worstMs: number;
  /** long tasks (>300ms) seen since start */
  longTasks: number;
  /** longest single long task (ms) */
  longestMs: number;
  /** total time the main thread spent blocked, measured by timer drift */
  blockedMs: number;
  note: (patch: Partial<PerfState>) => void;
}

export const usePerf = create<PerfState>((set) => ({
  fps: 0,
  worstMs: 0,
  longTasks: 0,
  longestMs: 0,
  blockedMs: 0,
  note: (patch) => set(patch),
}));

const SAMPLE_MS = 250;
const LONG_TASK_MS = 300;

/** Starts the watchdog; returns a stop function (unused in the app, used by tests). */
export function startPerfWatchdog(): () => void {
  const note = usePerf.getState().note;

  // ---- 1. long tasks -------------------------------------------------------
  let observer: PerformanceObserver | null = null;
  const types = (globalThis.PerformanceObserver?.supportedEntryTypes ?? []) as string[];
  if (types.includes("longtask")) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_MS) continue;
        const s = usePerf.getState();
        note({
          longTasks: s.longTasks + 1,
          longestMs: Math.max(s.longestMs, Math.round(entry.duration)),
        });
        if (import.meta.env.DEV) {
          // `attribution` is Chromium-specific and not in the base DOM typing
          const attribution = (entry as PerformanceEntry & {
            attribution?: { name?: string }[];
          }).attribution;
          const where = attribution?.[0]?.name ?? entry.name ?? "self";
          console.warn(`[perf] long task ${Math.round(entry.duration)}ms (${where})`);
        }
      }
    });
    try {
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = null;
    }
  }

  // ---- 2. main-thread drift ------------------------------------------------
  // A 250ms timer that arrives a second late means the thread was blocked for a
  // second. This catches stalls that never produce a long-task entry (e.g. a
  // synchronous decode inside an event handler).
  let expected = performance.now();
  const drift = window.setInterval(() => {
    const now = performance.now();
    const late = now - expected - SAMPLE_MS;
    expected = now;
    if (late > SAMPLE_MS) {
      const s = usePerf.getState();
      note({ blockedMs: s.blockedMs + Math.round(late) });
      if (import.meta.env.DEV) console.warn(`[perf] main thread blocked ~${Math.round(late)}ms`);
    }
  }, SAMPLE_MS);

  // ---- 3. frame rate -------------------------------------------------------
  let frames = 0;
  let worst = 0;
  let windowStart = performance.now();
  let prev = windowStart;
  let raf = requestAnimationFrame(function tick() {
    const now = performance.now();
    const delta = now - prev;
    prev = now;
    frames += 1;
    if (delta > worst) worst = delta;
    if (now - windowStart >= 4 * SAMPLE_MS) {
      note({
        fps: Math.round((frames * 1000) / (now - windowStart)),
        worstMs: Math.round(worst),
      });
      frames = 0;
      worst = 0;
      windowStart = now;
    }
    raf = requestAnimationFrame(tick);
  });

  return () => {
    observer?.disconnect();
    window.clearInterval(drift);
    cancelAnimationFrame(raf);
  };
}
