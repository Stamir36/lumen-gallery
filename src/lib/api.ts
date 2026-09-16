import { invoke } from "@tauri-apps/api/core";

export interface VolumeInfo {
  name: string;
  mountPoint: string;
  kind: string; // removable | fixed
  totalBytes: number;
  availableBytes: number;
  fileSystem: string;
}

export interface RootRow {
  id: number;
  path: string;
  kind: string;
  label: string;
  addedAt: number;
  itemCount: number;
  totalBytes: number;
  availableBytes: number;
}

export interface MediaRow {
  id: number;
  rootId: number;
  path: string;
  kind: "image" | "video";
  ext: string;
  size: number;
  mtime: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  favorite: boolean;
  trashed: boolean;
  addedAt: number;
}

export interface ScanProgress {
  rootId: number;
  phase: "walk" | "finalize";
  done: number;
  total: number;
  currentPath: string;
  added: number;
}

export type MediaFilter =
  | "all"
  | "images"
  | "videos"
  | "favorites"
  | "trash";

export const api = {
  getVolumes: () => invoke<VolumeInfo[]>("get_volumes"),
  listRoots: () => invoke<RootRow[]>("list_roots"),
  addRoot: (path: string, kind?: string, label?: string) =>
    invoke<RootRow>("add_root", { path, kind, label }),
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),
  rescanRoot: (id: number) => invoke<number>("rescan_root", { id }),
  rescanAll: () => invoke<number>("rescan_all"),
  listMedia: (
    limit = 200,
    offset = 0,
    filter: MediaFilter | "all" = "all",
  ) =>
    invoke<MediaRow[]>("list_media", {
      limit,
      offset,
      filter: filter === "all" ? null : filter,
    }),
  libraryStats: () => invoke<[number, number]>("library_stats"),
  cancelScan: (rootId: number) => invoke<void>("cancel_scan", { rootId }),
};

/** Human-readable byte size, mono-friendly (e.g. "212 GB"). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i <= 1 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** "12,482" — mono counters. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}