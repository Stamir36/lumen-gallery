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
  /**
   * VIDEO pipeline stats — answers "why does it think after a seek".
   * `videoLoadMs`: source → first frame for the LAST video opened.
   * `videoSeekMs`: seek request → frame painted, LAST seek (null = none yet).
   * `videoSeeks`: seeks counted since start; `videoWorstSeekMs` the worst one.
   * `videoBufferingMs`: total time spent in `waiting` (starved buffer).
   * Fed from VideoPlayer's element events; reset per row change.
   */
  videoLoadMs: number | null;
  videoSeekMs: number | null;
  videoSeeks: number;
  videoWorstSeekMs: number;
  videoBufferingMs: number;
  note: (patch: Partial<PerfState>) => void;
}

export const usePerf = create<PerfState>((set) => ({
  fps: 0,
  worstMs: 0,
  longTasks: 0,
  longestMs: 0,
  blockedMs: 0,
  videoLoadMs: null,
  videoSeekMs: null,
  videoSeeks: 0,
  videoWorstSeekMs: 0,
  videoBufferingMs: 0,
  note: (patch) => set(patch),
}));

/**
 * HISTORY ring buffers (profiler sparklines). Everything lives OUTSIDE the
 * zustand store on purpose: the graphs need ~120 points that change 4×/s, and
 * pushing that through the store would re-render every subscriber for data
 * only the overlay reads. The overlay samples on its own 1 Hz cadence and
 * re-renders itself — the watchdog just appends here.
 */
export const PERF_HISTORY_CAP = 120;

export interface HistoryPoint {
  fps: number;
  /** worst frame of the window, ms */
  worstMs: number;
}

export const perfHistory: HistoryPoint[] = [];

/** one event marker on the timeline (load finished, a seek, a stall) */
export interface HistoryEvent {
  /** index into perfHistory at append time (drifts left as the ring advances) */
  at: number;
  kind: "load" | "seek" | "stall";
  /** payload ms (load/seek latency) — rendered in the tooltip row */
  ms?: number;
}

export const perfEvents: HistoryEvent[] = [];

function pushHistory(p: HistoryPoint) {
  perfHistory.push(p);
  if (perfHistory.length > PERF_HISTORY_CAP) perfHistory.shift();
}

function pushEvent(kind: HistoryEvent["kind"], ms?: number) {
  perfEvents.push({ at: perfHistory.length, kind, ms });
  // events older than the visible window are meaningless — keep the list short
  if (perfEvents.length > PERF_HISTORY_CAP) perfEvents.splice(0, perfEvents.length - PERF_HISTORY_CAP);
}

/**
 * Video timing probe — the stats live HERE (not in the component) so the
 * profiler overlay and any future console dump read the same numbers.
 * `perf.note` is a plain zustand set, so a burst of events is cheap.
 */
export const videoPerf = {
  /** timestamp of the last `loadedmetadata` / row swap */
  loadStart: 0,
  /** timestamp of the last `seeking` (0 = no seek in flight) */
  seekStart: 0,
  /** timestamp the last `waiting` began (0 = not buffering) */
  waitingStart: 0,
};

export function videoPerfReset() {
  videoPerf.loadStart = performance.now();
  videoPerf.seekStart = 0;
  videoPerf.waitingStart = 0;
  usePerf.getState().note({ videoLoadMs: null, videoSeekMs: null });
}

export function videoPerfLoaded() {
  if (!videoPerf.loadStart) return;
  const ms = Math.round(performance.now() - videoPerf.loadStart);
  usePerf.getState().note({ videoLoadMs: ms });
  pushEvent("load", ms);
}

export function videoPerfSeekStart() {
  videoPerf.seekStart = performance.now();
}

export function videoPerfSeeked() {
  if (!videoPerf.seekStart) return;
  const ms = Math.round(performance.now() - videoPerf.seekStart);
  const s = usePerf.getState();
  usePerf.getState().note({
    videoSeekMs: ms,
    videoSeeks: s.videoSeeks + 1,
    videoWorstSeekMs: Math.max(s.videoWorstSeekMs, ms),
  });
  videoPerf.seekStart = 0;
  pushEvent("seek", ms);
}

export function videoPerfWaiting(on: boolean) {
  if (on) {
    if (!videoPerf.waitingStart) pushEvent("stall");
    videoPerf.waitingStart = performance.now();
    return;
  }
  if (!videoPerf.waitingStart) return;
  const s = usePerf.getState();
  usePerf
    .getState()
    .note({ videoBufferingMs: s.videoBufferingMs + Math.round(performance.now() - videoPerf.waitingStart) });
  videoPerf.waitingStart = 0;
}

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
      const fps = Math.round((frames * 1000) / (now - windowStart));
      const worstMs = Math.round(worst);
      note({ fps, worstMs });
      pushHistory({ fps, worstMs });
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
