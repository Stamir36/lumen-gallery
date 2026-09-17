import { create } from "zustand";
import type { MediaFilter } from "@/lib/api";

export type ViewMode = "justified" | "masonry" | "square" | "list";
/** gallery = the library as one stream · explorer = the library as a disk tree */
export type BrowseMode = "gallery" | "explorer";
export type SortKey = "date" | "name" | "size" | "duration" | "added";

export type SmartView =
  | "all"
  | "images"
  | "videos"
  | "favorites"
  | "albums"
  | "recents"
  | "trash";

export interface SmartRoute {
  kind: "smart";
  id: SmartView;
}

export interface RootRoute {
  kind: "root";
  rootId: number;
  /** current folder (absolute path) or null at the root level */
  dir: string | null;
}

export type Route = SmartRoute | RootRoute;

/** Filter implied by a smart view (the route drives the query, not the chips). */
export function filterForRoute(route: Route, chip: MediaFilter): MediaFilter {
  if (route.kind === "root") return chip === "all" ? "all" : chip;
  if (route.id === "images") return "images";
  if (route.id === "videos") return "videos";
  if (route.id === "favorites") return "favorites";
  if (route.id === "trash") return "trash";
  // albums are DB-only collections (Phase 5) — nothing to filter yet
  if (route.id === "albums") return "all";
  return chip;
}

interface LibraryUiState {
  route: Route;
  view: ViewMode;
  browse: BrowseMode;
  sort: SortKey;
  desc: boolean;
  q: string;
  chip: MediaFilter;
  /** root routes: folder cards vs. the recursive media grid */
  foldersView: boolean;
  selectionMode: boolean;
  selected: number[];
  setRoute: (route: Route) => void;
  openRoot: (rootId: number) => void;
  openFolder: (dir: string | null) => void;
  /** `rootPath` bounds the walk: the root level is as far up as we go. */
  goUp: (rootPath?: string) => void;
  setView: (view: ViewMode) => void;
  setBrowse: (browse: BrowseMode) => void;
  setSort: (sort: SortKey) => void;
  setDesc: (desc: boolean) => void;
  setQ: (q: string) => void;
  setChip: (chip: MediaFilter) => void;
  setFoldersView: (on: boolean) => void;
  toggleSelectionMode: () => void;
  toggleSelected: (id: number) => void;
  clearSelection: () => void;
  /** runs after a scan/rescan finishes: same route, but the rows must refetch */
  dataVersion: number;
  bumpData: () => void;
}

const VIEW_KEY = "ui.view_mode";
const BROWSE_KEY = "ui.browse_mode";

function persistedBrowse(): BrowseMode {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(BROWSE_KEY) : null;
  return v === "explorer" ? "explorer" : "gallery";
}

function persistedView(): ViewMode {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
  return v === "masonry" || v === "square" || v === "list" || v === "justified"
    ? v
    : "justified";
}

export const useLibraryUi = create<LibraryUiState>((set, get) => ({
  route: { kind: "smart", id: "all" },
  view: persistedView(),
  browse: persistedBrowse(),
  sort: "date",
  desc: true,
  q: "",
  chip: "all",
  foldersView: true,
  selectionMode: false,
  selected: [],
  dataVersion: 0,

  setRoute: (route) =>
    set({
      route,
      q: "",
      chip: "all",
      selectionMode: false,
      selected: [],
      foldersView: route.kind === "root",
    }),

  openRoot: (rootId) => get().setRoute({ kind: "root", rootId, dir: null }),

  openFolder: (dir) => {
    const route = get().route;
    if (route.kind !== "root") return;
    set({ route: { ...route, dir }, selectionMode: false, selected: [] });
  },

  goUp: (rootPath) => {
    const route = get().route;
    if (route.kind !== "root" || !route.dir) return;
    const sep = route.dir.includes("\\") ? "\\" : "/";
    const trimmed = route.dir.replace(/[\\/]+$/, "");
    const parent = trimmed.slice(0, Math.max(0, trimmed.lastIndexOf(sep)));
    const rootTrim = (rootPath ?? "").replace(/[\\/]+$/, "");
    // never climb above the library root (the parent of "C:\\Photos" is "C:")
    const inside = parent.length > 0 && (rootTrim.length === 0 || parent.length >= rootTrim.length);
    set({
      route: { ...route, dir: inside ? parent : null },
      selectionMode: false,
      selected: [],
    });
  },

  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode — view just isn't persisted */
    }
    set({ view });
  },

  setBrowse: (browse) => {
    try {
      localStorage.setItem(BROWSE_KEY, browse);
    } catch {
      /* private mode — mode just isn't persisted */
    }
    // the explorer is always folder-scoped and name-ordered: date headers in a
    // file manager are noise, and the folder listing must read like a disk
    set((s) => ({
      browse,
      foldersView: true,
      sort: browse === "explorer" ? "name" : s.sort,
      desc: browse === "explorer" ? false : s.desc,
      selectionMode: false,
      selected: [],
    }));
  },

  setSort: (sort) => set({ sort, desc: sort !== "name" }),
  setDesc: (desc) => set({ desc }),
  setQ: (q) => set({ q }),
  setChip: (chip) => set({ chip }),
  setFoldersView: (foldersView) => set({ foldersView, selected: [], selectionMode: false }),

  toggleSelectionMode: () =>
    set((s) => ({ selectionMode: !s.selectionMode, selected: [] })),

  toggleSelected: (id) =>
    set((s) => ({
      selected: s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id],
    })),

  clearSelection: () => set({ selected: [], selectionMode: false }),

  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
