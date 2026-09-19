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
  /** optimistic favourite for the current media + persistence through db_exec */
  toggleFavorite: (row: MediaRow) => void;
  favoriteOf: (row: MediaRow) => boolean;
  clearReveal: () => void;
}

export const useViewer = create<ViewerState>((set, get) => ({
  open: false,
  queue: [],
  index: 0,
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

  toggleFavorite: (row) => {
    const now = get().favoriteOf(row);
    set((s) => ({ favorites: { ...s.favorites, [row.id]: !now } }));
    void persistFavorite(row.id);
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
