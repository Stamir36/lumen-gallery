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
  /** id the grid should scroll back to after the viewer closes (STEP 3) */
  revealId: number | null;
  openAt: (queue: MediaRow[], index: number) => void;
  close: () => void;
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

  openAt: (queue, index) =>
    set({
      open: true,
      queue,
      index: Math.max(0, Math.min(queue.length - 1, index)),
      revealId: null,
    }),

  close: () => {
    const { queue, index } = get();
    const current = queue[index];
    set({
      open: false,
      infoOpen: false,
      stripOpen: false,
      // STEP 3: returning to the grid scrolls to the item we were looking at
      revealId: current ? current.id : null,
    });
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

  clearReveal: () => set({ revealId: null }),
}));
