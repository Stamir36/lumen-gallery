import { create } from "zustand";
import type { MediaFilter } from "@/lib/api";
import { useViewer } from "@/state/viewer";

/**
 * P2 — any user-driven navigation INSIDE the library means the gallery has been
 * seen: the "external file" session ends, and the viewer's X goes back to
 * closing only the viewer. Every route action funnels through here.
 */
function seenGallery() {
  useViewer.getState().visitGallery();
}

export type ViewMode = "justified" | "masonry" | "square" | "list";
/** gallery = the library as one stream · explorer = the library as a disk tree */
export type BrowseMode = "gallery" | "explorer";
/**
 * Explorer sub-layout (S1.9): `tree` = folder tree on the left + the open
 * folder's contents; `grid` = no tree, subfolder cards above the contents.
 * Exactly one at a time — the directories used to be listed twice.
 */
export type ExplorerLayout = "tree" | "grid";
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

/** What each browse mode remembers independently (FIX 3: no cross-mode resets). */
interface ModeSnapshot {
  route: Route;
  q: string;
  chip: MediaFilter;
  sort: SortKey;
  desc: boolean;
  foldersView: boolean;
}

const EMPTY_SNAPSHOT: ModeSnapshot = {
  route: { kind: "smart", id: "all" },
  q: "",
  chip: "all",
  sort: "date",
  desc: true,
  foldersView: true,
};

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
  /** per-mode snapshots: toggling modes restores exactly where you were */
  snapshots: Record<BrowseMode, ModeSnapshot>;
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
  /** explorer only: folder tree vs wrapping subfolder cards */
  explorerLayout: ExplorerLayout;
  setExplorerLayout: (layout: ExplorerLayout) => void;
  /** scroll offsets per browse mode (restored by the grid) */
  scrollOffsets: Record<BrowseMode, number>;
  saveScroll: (offset: number) => void;
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
const EXPLORER_LAYOUT_KEY = "ui.explorer_layout";

function persistedExplorerLayout(): ExplorerLayout {
  const v =
    typeof localStorage !== "undefined" ? localStorage.getItem(EXPLORER_LAYOUT_KEY) : null;
  return v === "grid" ? "grid" : "tree";
}

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
  explorerLayout: persistedExplorerLayout(),
  snapshots: {
    gallery: { ...EMPTY_SNAPSHOT },
    explorer: { ...EMPTY_SNAPSHOT, sort: "name", desc: false },
  },
  scrollOffsets: { gallery: 0, explorer: 0 },
  sort: "date",
  desc: true,
  q: "",
  chip: "all",
  foldersView: true,
  selectionMode: false,
  selected: [],
  dataVersion: 0,

  setRoute: (route) => {
    seenGallery();
    set({
      route,
      q: "",
      chip: "all",
      selectionMode: false,
      selected: [],
      foldersView: route.kind === "root",
    });
  },

  openRoot: (rootId) => get().setRoute({ kind: "root", rootId, dir: null }),

  openFolder: (dir) => {
    const route = get().route;
    if (route.kind !== "root") return;
    seenGallery();
    set({ route: { ...route, dir }, selectionMode: false, selected: [] });
  },

  goUp: (rootPath) => {
    seenGallery();
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

  setBrowse: (browse) =>
    set((s) => {
      if (s.browse === browse) return {};
      seenGallery();
      try {
        localStorage.setItem(BROWSE_KEY, browse);
      } catch {
        /* private mode — mode just isn't persisted */
      }
      // snapshot the CURRENT mode (route/query/sort/scroll all stick), then
      // restore the OTHER mode's last state; nothing is reset, ever
      const snapshots: Record<BrowseMode, ModeSnapshot> = {
        ...s.snapshots,
        [s.browse]: {
          route: s.route,
          q: s.q,
          chip: s.chip,
          sort: s.sort,
          desc: s.desc,
          foldersView: s.foldersView,
        },
      };
      const next = snapshots[browse];
      return {
        browse,
        snapshots,
        route: next.route,
        q: next.q,
        chip: next.chip,
        sort: next.sort,
        desc: next.desc,
        foldersView: next.foldersView,
        selectionMode: false,
        selected: [],
      };
    }),

  setExplorerLayout: (explorerLayout) => {
    try {
      localStorage.setItem(EXPLORER_LAYOUT_KEY, explorerLayout);
    } catch {
      /* private mode — the layout just isn't persisted */
    }
    set({ explorerLayout });
  },

  saveScroll: (offset) =>
    set((s) => ({
      scrollOffsets: { ...s.scrollOffsets, [s.browse]: offset },
    })),

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
