import { create } from "zustand";
import type { MediaRow } from "@/lib/api";
import { toggleFavorite as persistFavorite } from "@/lib/mediaActions";

/**
 * Viewer store (STEP 3): the lightbox and the video player share ONE queue, so
 * arrows and the filmstrip keep moving through the same view order the grid is
 * showing. The queue is a snapshot of the grid's rows; nothing here re-renders
 * the grid underneath (the grid only listens for `revealId` after a close).
 */
interface ViewerState {
  open: boolean;
  /** the media the arrows / filmstrip walk through, in grid order */
  queue: MediaRow[];
  index: number;
  /**
   * P6 — session queue ORDER. "view" walks the grid order; "shuffle" walks a
   * randomised queue whose first item is whatever was on screen when the user
   * flipped the switch. `baseQueue` keeps the untouched grid order so turning it
   * OFF restores the original queue (and the cursor position) exactly.
   */
  order: "view" | "shuffle";
  baseQueue: MediaRow[];
  /** mono info panel (image + video) */
  infoOpen: boolean;
  /** bottom filmstrip (image) / right "up next" rail (video) */
  stripOpen: boolean;
  /** favourite overrides so the heart reacts instantly inside the viewer */
  favorites: Record<number, boolean>;
  /**
   * P2 — CONTEXT-AWARE CLOSE. "external" while the window was opened WITH a
   * file (CLI arg, file association, drag-drop) and the user has not reached the
   * library yet; "internal" after the gallery was entered (back button or any
   * library route). The X reads this: external → close the whole app window,
   * internal → close only the viewer (see requestClose).
   */
  session: "external" | "internal";
  /** id the grid should scroll back to after the viewer closes (STEP 3) */
  revealId: number | null;
  /** true when the fullscreen window came WITH the open (external file, STEP 3):
   *  viewers restore the window state on close only in that case */
  fsByUser: boolean;
  openAt: (queue: MediaRow[], index: number, session?: "external" | "internal") => void;
  close: () => void;
  /** the X: closes the app window for an external session, else the viewer */
  requestClose: () => void;
  /** the user reached the library — the external session is over */
  visitGallery: () => void;
  step: (delta: number) => void;
  setIndex: (index: number) => void;
  toggleInfo: () => void;
  toggleStrip: () => void;
  /** P6: randomise the queue · restore the view order */
  toggleShuffle: () => void;
  /** optimistic favourite for the current media + persistence through db_exec */
  toggleFavorite: (row: MediaRow) => void;
  favoriteOf: (row: MediaRow) => boolean;
  clearReveal: () => void;
}

export const useViewer = create<ViewerState>((set, get) => ({
  open: false,
  queue: [],
  index: 0,
  order: "view",
  baseQueue: [],
  infoOpen: false,
  stripOpen: false,
  favorites: {},
  revealId: null,
  fsByUser: false,
  session: "internal",

  openAt: (queue, index, session = "internal") =>
    set({
      open: true,
      queue,
      index: Math.max(0, Math.min(queue.length - 1, index)),
      revealId: null,
      fsByUser: false,
      session,
      // a fresh open always starts in view order
      order: "view",
      baseQueue: [],
    }),

  close: () => {
    const { queue, index, fsByUser } = get();
    const current = queue[index];
    set({
      open: false,
      infoOpen: false,
      stripOpen: false,
      // STEP 3: returning to the grid scrolls to the item we were looking at
      revealId: current ? current.id : null,
      fsByUser: false,
      // any close that lands in the app means the gallery is now on screen
      session: "internal",
    });
    // external open entered fullscreen automatically — leave it symmetrically
    // (a user who left it earlier has fsByUser=true and keeps their choice)
    if (!fsByUser) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(false))
        .catch(() => undefined);
    }
  },

  step: (delta) => {
    const { index, queue } = get();
    const next = index + delta;
    if (next < 0 || next >= queue.length) return;
    set({ index: next });
  },

  setIndex: (index) => set({ index }),
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  toggleStrip: () => set((s) => ({ stripOpen: !s.stripOpen })),

  toggleShuffle: () => {
    const { queue, index, order, baseQueue } = get();
    if (queue.length < 2) return;
    const current = queue[index];
    if (order === "view") {
      const rest = queue.filter((r) => r.id !== current?.id);
      // Fisher–Yates: an unbiased shuffle (sort(() => Math.random() - 0.5) is not)
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      // the item you were looking at stays first, so switching never jumps
      set({
        order: "shuffle",
        queue: current ? [current, ...rest] : rest,
        index: 0,
        baseQueue: queue,
      });
      return;
    }
    const restored = baseQueue.length > 0 ? baseQueue : queue;
    const at = current ? restored.findIndex((r) => r.id === current.id) : -1;
    set({ order: "view", queue: restored, index: at < 0 ? 0 : at, baseQueue: [] });
  },

  toggleFavorite: (row) => {
    const now = get().favoriteOf(row);
    set((s) => ({ favorites: { ...s.favorites, [row.id]: !now } }));
    // B9: the optimistic flip here is SEPARATE from the query cache, so a failed
    // write used to roll the grid back but leave the viewer's heart flipped —
    // heart and DB disagreed until restart. Drop the override with the cache.
    void persistFavorite(row.id).then((ok) => {
      if (ok) return;
      set((s) => {
        const favorites = { ...s.favorites };
        delete favorites[row.id];
        return { favorites };
      });
    });
  },

  favoriteOf: (row) => get().favorites[row.id] ?? row.favorite,

  /**
   * P2 — the X is NOT the same action as Esc:
   *  - external session (the window was opened with a file and the user has
   *    never seen the library): closing only the viewer would dump them into a
   *    gallery they never asked for, so the X closes the whole window;
   *  - otherwise: close only the viewer, exactly like Esc / the back button.
   */
  requestClose: () => {
    if (get().session !== "external") {
      get().close();
      return;
    }
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
      .catch((e) => {
        // browser QA / no window api: degrade to closing the viewer
        console.error("app window close failed", e);
        get().close();
      });
  },

  visitGallery: () =>
    set((s) => (s.session === "internal" ? {} : { session: "internal" })),

  clearReveal: () => set({ revealId: null }),
}));
