import { create } from "zustand";
import type { ReactNode } from "react";

/**
 * Right-click menu state (FIX 8): ONE host for the whole app, opened by any
 * surface that can describe its own actions. Keeping the model here (instead of
 * a per-card menu component) means the menu can never be mounted twice, and a
 * card only sends a cursor position plus a list of items.
 */
export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** mono hint on the right — a shortcut, a count, a format */
  hint?: string;
  onSelect: () => void;
}

export interface MenuSection {
  id: string;
  /** mono uppercase section label (optional) */
  label?: string;
  items: MenuItem[];
}

interface OpenArgs {
  x: number;
  y: number;
  /** bold first line of the menu header */
  title?: string;
  /** mono second line (path, count, resolution) */
  mono?: string;
  sections: MenuSection[];
}

interface ContextMenuState extends OpenArgs {
  open: boolean;
  openMenu: (args: OpenArgs) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  title: undefined,
  mono: undefined,
  sections: [],
  openMenu: ({ x, y, title, mono, sections }) =>
    set({ open: true, x, y, title, mono, sections }),
  close: () => set({ open: false, sections: [] }),
}));

/** A disabled item must still be visible, but never fire. */
export function runItem(item: MenuItem) {
  if (item.disabled) return;
  useContextMenu.getState().close();
  item.onSelect();
}
