import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, type ScanProgress, type RootRow } from "@/lib/api";

const LOG_TAIL = 200;

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

/** Subscribes to Rust `scan-progress` events exactly once per session. */
let listenerPromise: Promise<() => void> | null = null;
export function initScanListener() {
  if (!listenerPromise) {
    listenerPromise = listen<ScanProgress>("scan-progress", (e) => {
      const p = e.payload;
      useScanStore.getState().applyProgress(p);
      if (p.phase === "finalize") {
        useRootsStore.getState().refresh();
      }
    });
  }
  return listenerPromise;
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
    } catch {
      set({ roots: [] });
    }
  },

  remove: async (id) => {
    await api.removeRoot(id);
    await get().refresh();
  },

  rescan: async (id) => {
    useScanStore.getState().setScanning(id);
    try {
      await api.rescanRoot(id);
    } finally {
      useScanStore.getState().finish();
      await get().refresh();
    }
  },
}));