import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import i18n from "@/i18n";
import { api, type ScanProgress, type RootRow } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

const LOG_TAIL = 200;

/** Onboarding view state machine (FIX 6). */
export type OnboardingView = "picker" | "scanning" | "done";

export interface LogLine {
  at: number;
  text: string;
}

interface ScanState {
  scanningRootId: number | null;
  phase: "walk" | "finalize" | "idle";
  done: number;
  total: number;
  added: number;
  currentPath: string;
  log: LogLine[];
  lastScanAt: number | null;
  /** Explicit onboarding view state; reset() always returns to picker. */
  view: OnboardingView;
  setView: (v: OnboardingView) => void;
  /** Reset to the picker state (used by EVERY add-library entry point). */
  resetToPicker: () => void;
  setScanning: (rootId: number | null) => void;
  applyProgress: (p: ScanProgress) => void;
  finish: () => void;
  clearLog: () => void;
}

export const useScanStore = create<ScanState>((set) => ({
  scanningRootId: null,
  phase: "idle",
  done: 0,
  total: 0,
  added: 0,
  currentPath: "",
  log: [],
  lastScanAt: null,
  view: "picker",

  setView: (view) => set({ view }),

  resetToPicker: () =>
    set({
      view: "picker",
      scanningRootId: null,
      phase: "idle",
      done: 0,
      total: 0,
      added: 0,
      currentPath: "",
    }),

  setScanning: (rootId) =>
    set({
      scanningRootId: rootId,
      phase: rootId === null ? "idle" : "walk",
      done: 0,
      total: 0,
      added: 0,
      currentPath: "",
    }),

  applyProgress: (p) =>
    set((s) => {
      // dedupe: same path+phase repeated (multiple listeners / event replays)
      const key = `${p.phase}:${p.currentPath}`;
      const last = s.log[s.log.length - 1]?.text;
      const text =
        p.phase === "finalize"
          ? `finalize · ${p.total} files seen · ${p.added} added`
          : p.currentPath || "…";
      const log = last === (p.phase === "finalize" ? text : key) || last === text
        ? s.log
        : [...s.log, { at: Date.now(), text }].slice(-LOG_TAIL);
      return {
        scanningRootId: p.rootId,
        phase: p.phase,
        done: p.done,
        total: p.total,
        added: p.added,
        currentPath: p.currentPath,
        log,
        lastScanAt: p.phase === "finalize" ? Date.now() : s.lastScanAt,
      };
    }),

  finish: () =>
    set({ scanningRootId: null, phase: "idle", currentPath: "" }),

  clearLog: () => set({ log: [] }),
}));

/** Anything that changes the rows on disk must refresh what the grid shows. */
export function refreshLibraryData() {
  void queryClient.invalidateQueries({ queryKey: ["media"] });
  void queryClient.invalidateQueries({ queryKey: ["library-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["folders"] });
}

/** Subscribes to Rust `scan-progress` events exactly once per session. */
let listenerPromise: Promise<() => void> | null = null;
export function initScanListener() {
  if (!listenerPromise) {
    listenerPromise = listen<ScanProgress>("scan-progress", (e) => {
      const p = e.payload;
      useScanStore.getState().applyProgress(p);
      if (p.phase === "finalize") {
        useRootsStore.getState().refresh();
        refreshLibraryData();
      }
    });
  }
  return listenerPromise;
}

/**
 * `root-offline` (scan.rs): the drive vanished mid-session. Its rows are kept
 * and flagged offline in Rust — the UI must say so out loud instead of
 * silently painting grey tiles.
 */
let offlinePromise: Promise<() => void> | null = null;
export function initOfflineListener() {
  if (!offlinePromise) {
    offlinePromise = listen<{ rootId: number; path: string }>("root-offline", (e) => {
      const label = e.payload.path.split(/[\\/]/).filter(Boolean).pop() ?? e.payload.path;
      console.warn("root offline:", e.payload);
      toast.warning(i18n.t("offline.toast", { label }));
      void useRootsStore.getState().refresh();
      refreshLibraryData();
    });
  }
  return offlinePromise;
}

interface RootsState {
  roots: RootRow[];
  loaded: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  rescan: (id: number) => Promise<void>;
}

export const useRootsStore = create<RootsState>((set, get) => ({
  roots: [],
  loaded: false,

  load: async () => {
    await get().refresh();
    set({ loaded: true });
  },

  refresh: async () => {
    try {
      const roots = await api.listRoots();
      set({ roots });
    } catch (e) {
      console.error("list_roots failed:", e);
      toast.error("list_roots failed — see console (F12)");
      set({ roots: [] });
    }
  },

  remove: async (id) => {
    await api.removeRoot(id);
    await get().refresh();
    refreshLibraryData();
  },

  rescan: async (id) => {
    useScanStore.getState().setScanning(id);
    try {
      await api.rescanRoot(id);
    } finally {
      useScanStore.getState().finish();
      await get().refresh();
      refreshLibraryData();
    }
  },
}));