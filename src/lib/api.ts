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

/**
 * Rust serializes timestamps straight out of SQLite (`unixepoch()` / 
 * `SystemTime::as_secs`) — seconds. Every formatter in src/lib/format.ts takes
 * MILLISECONDS, so this module converts once, at the IPC boundary.
 */
function secondsToMs(secs: number): number {
  return secs > 0 ? secs * 1000 : secs;
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
  /** cached thumbnail file (appCacheDir/thumbs/<id>.jpg) once generated */
  thumbPath: string | null;
  /** dominant color placeholder "#RRGGBB" for instant tiles */
  dominantColor: string | null;
  /** root was unreachable during the last scan — tile renders offline */
  offline: boolean;
  /** inside a folder the user excluded (FIX 5) — only fetched when "show excluded" is on */
  excluded: boolean;
  /**
   * decode failed permanently for this file (corrupt / mislabeled content):
   * the tile renders a "no preview" state instead of retrying on every scroll.
   */
  thumbError: boolean;
}

/** One folder card in root/folder navigation (STEP 3B). */
export interface FolderRow {
  path: string;
  name: string;
  count: number;
  coverId: number | null;
  coverThumb: string | null;
  coverColor: string | null;
}

/** Sidebar/status counters in one round trip. */
export interface LibrarySummary {
  total: number;
  bytes: number;
  images: number;
  videos: number;
  favorites: number;
  offline: number;
}

export interface ListMediaParams {
  limit?: number;
  offset?: number;
  filter?: MediaFilter;
  rootId?: number | null;
  /** folder scope: only files DIRECTLY inside this directory */
  dir?: string | null;
  /** filename substring search */
  q?: string;
  sort?: "date" | "name" | "size" | "duration" | "added";
  desc?: boolean;
  /** show media inside excluded folders (Settings › Appearance), default false */
  includeExcluded?: boolean;
}

/** A folder the user hid from the library (FIX 5). */
export interface ExcludedFolderRow {
  id: number;
  rootId: number;
  rootPath: string;
  path: string;
  name: string;
  /** how many media rows this exclusion currently hides */
  hidden: number;
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
  listMedia: async (params: ListMediaParams = {}): Promise<MediaRow[]> => {
    const rows = await invoke<MediaRow[]>("list_media", {
      limit: params.limit ?? 200_000,
      offset: params.offset ?? 0,
      filter: params.filter && params.filter !== "all" ? params.filter : null,
      rootId: params.rootId ?? null,
      dir: params.dir ?? null,
      q: params.q && params.q.trim() ? params.q.trim() : null,
      sort: params.sort ?? "date",
      desc: params.desc ?? true,
      includeExcluded: params.includeExcluded ?? false,
    });
    // THE unit boundary: seconds in Rust/SQLite -> ms everywhere in the UI.
    // Missing this made every date group render as January 1970.
    return rows.map((r) => ({
      ...r,
      mtime: secondsToMs(r.mtime),
      addedAt: secondsToMs(r.addedAt),
    }));
  },
  listFolders: (rootId: number, dir: string | null) =>
    invoke<FolderRow[]>("list_folders", { rootId, dir }),
  librarySummary: () => invoke<LibrarySummary>("library_summary"),
  libraryStats: () => invoke<[number, number]>("library_stats"),
  cancelScan: (rootId: number) => invoke<void>("cancel_scan", { rootId }),
  listExcluded: () => invoke<ExcludedFolderRow[]>("list_excluded"),
  excludeFolder: (rootId: number, path: string) =>
    invoke<void>("exclude_folder", { rootId, path }),
  restoreFolder: (rootId: number, path: string) =>
    invoke<void>("restore_folder", { rootId, path }),
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