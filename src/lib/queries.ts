import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type MediaFilter, type MediaRow } from "@/lib/api";
import { useAppSettings } from "@/lib/settings";
import type { SortKey } from "@/state/library-ui";
import type { Route } from "@/state/library-ui";

export interface MediaQueryParams {
  filter: MediaFilter;
  sort: SortKey;
  desc: boolean;
  q: string;
  rootId: number | null;
  dir: string | null;
  /** smart views stay flat (recursive); folder views are dir-scoped */
  enabled: boolean;
}

export function mediaQueryKey(p: MediaQueryParams) {
  return [
    "media",
    p.filter,
    p.sort,
    p.desc ? "desc" : "asc",
    p.q.trim().toLowerCase(),
    p.rootId ?? "all",
    p.dir ?? "-",
  ] as const;
}

/**
 * The grid's single source of rows. Loading the whole ordered set is what
 * makes width-dependent justified rows and date grouping possible; the Rust
 * side sorts/filters, so this stays a single round trip per query change.
 */
export function useMediaRows(p: MediaQueryParams) {
  // media inside excluded folders stay hidden unless the user asked to see them
  // (FIX 5) — the flag is part of the query key, so toggling it refetches
  const includeExcluded = useAppSettings((s) => s.showExcluded);
  return useQuery({
    queryKey: [...mediaQueryKey(p), includeExcluded ? "excl" : "no-excl"],
    enabled: p.enabled,
    // keep the previous grid painted while the next query resolves (no flash)
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: () =>
      api.listMedia({
        limit: 200_000,
        offset: 0,
        filter: p.filter,
        rootId: p.rootId,
        dir: p.dir,
        q: p.q,
        sort: p.sort,
        desc: p.desc,
        includeExcluded,
      }),
  });
}

export function useLibrarySummary(enabled = true) {
  return useQuery({
    queryKey: ["library-summary"],
    enabled,
    staleTime: 5_000,
    queryFn: () => api.librarySummary(),
  });
}

export function useExcludedFolders() {
  return useQuery({
    queryKey: ["excluded"],
    staleTime: 5_000,
    queryFn: () => api.listExcluded(),
  });
}

export function useFolders(rootId: number | null, dir: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["folders", rootId, dir ?? "-"],
    enabled: enabled && rootId !== null,
    staleTime: 15_000,
    queryFn: () => api.listFolders(rootId as number, dir),
  });
}

/** Rows currently needed by the grid (visible range + prefetch margin). */
export function collectThumbCandidates(rows: MediaRow[], start: number, end: number) {
  const from = Math.max(0, start - 40);
  const to = Math.min(rows.length, end + 80);
  return rows.slice(from, to);
}

export type { Route };
