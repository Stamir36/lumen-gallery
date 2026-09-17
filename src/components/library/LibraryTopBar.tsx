import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  FolderTree as FolderTreeIcon,
  Images as ImagesIcon,
  Search,
  SquareCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/api";
import { Segmented } from "@/components/ui/Segmented";
// (the gallery/explorer switch moved to the titlebar — FIX 5)
import { IconButton } from "@/components/ui/IconButton";
import { GlassTopBar } from "@/components/ui/GlassTopBar";
import { useLibraryUi, type SortKey } from "@/state/library-ui";
import { useRootsStore } from "@/state/library";
import { Breadcrumbs } from "./Breadcrumbs";

const SORTS: { key: SortKey; labelKey: string }[] = [
  { key: "date", labelKey: "topbar.sort_date" },
  { key: "name", labelKey: "topbar.sort_name" },
  { key: "size", labelKey: "topbar.sort_size" },
  { key: "duration", labelKey: "topbar.sort_duration" },
];

/**
 * Library bar — ONE row (v2.2): breadcrumbs/title + mono count, search, sort,
 * folder scope, selection toggle. The chips row was deleted — the sidebar smart
 * views already cover All/Photos/Videos/Favorites; the gallery/explorer switch
 * lives in the titlebar (FIX 5), next to the view icons.
 */
export function LibraryTopBar({ title, count }: { title: string; count: number }) {
  const { t } = useTranslation();
  const roots = useRootsStore((s) => s.roots);
  const route = useLibraryUi((s) => s.route);
  const q = useLibraryUi((s) => s.q);
  const setQ = useLibraryUi((s) => s.setQ);
  const foldersView = useLibraryUi((s) => s.foldersView);
  const setFoldersView = useLibraryUi((s) => s.setFoldersView);
  const browse = useLibraryUi((s) => s.browse);
  const selectionMode = useLibraryUi((s) => s.selectionMode);
  const toggleSelectionMode = useLibraryUi((s) => s.toggleSelectionMode);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere in the library (SPEC §6)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const root = route.kind === "root" ? roots.find((r) => r.id === route.rootId) : undefined;

  return (
    <GlassTopBar
      left={
        <>
          {root ? (
            <Breadcrumbs
              rootLabel={root.label || root.path}
              rootPath={root.path}
              dir={route.kind === "root" ? route.dir : null}
              count={count}
            />
          ) : (
            <div className="flex min-w-0 shrink-0 items-baseline gap-3">
              <span className="truncate text-lg font-semibold text-tprimary">{title}</span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-ttertiary">
                {formatCount(count)}
              </span>
            </div>
          )}

          {q.trim() && (
            <span className="ml-1 shrink-0 font-mono text-[11px] whitespace-nowrap text-ttertiary">
              {t("grid.results", { count })}
            </span>
          )}
        </>
      }
      right={
        <>
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ttertiary"
            />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQ("");
                  e.currentTarget.blur();
                }
              }}
              placeholder={t("topbar.search_placeholder")}
              aria-label={t("topbar.search_placeholder")}
              className="h-10 w-[min(340px,26vw)] rounded-pill bg-surface-2 pl-10 pr-10 text-sm text-tprimary outline-none transition-colors duration-[160ms] placeholder:text-ttertiary hover:bg-surface-3 focus:bg-surface-3"
            />
            {q ? (
              <button
                type="button"
                aria-label={t("topbar.clear_search")}
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ttertiary hover:text-tprimary"
              >
                esc
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-[6px] bg-white/[.06] px-1.5 font-mono text-[11px] text-ttertiary">
                /
              </span>
            )}
          </div>

          {/* the folders/all scope is meaningless in explorer mode (it is the folders) */}
          {route.kind === "root" && browse !== "explorer" && (
            <Segmented
              aria-label={t("topbar.folder_scope")}
              value={foldersView ? "folders" : "all"}
              onChange={(v) => setFoldersView(v === "folders")}
            options={[
              { value: "folders", label: t("topbar.scope_folders"), icon: <FolderTreeIcon size={16} /> },
              { value: "all", label: t("topbar.scope_all"), icon: <ImagesIcon size={16} /> },
            ]}
            />
          )}

          <SortMenu />

          <IconButton
            label={t("topbar.selection_mode")}
            aria-pressed={selectionMode}
            onClick={toggleSelectionMode}
            className={cn(selectionMode && "bg-surface-2 text-tprimary")}
          >
            <SquareCheck size={18} />
          </IconButton>
        </>
      }
    />
  );
}

function SortMenu() {
  const { t } = useTranslation();
  const sort = useLibraryUi((s) => s.sort);
  const setSort = useLibraryUi((s) => s.setSort);
  const desc = useLibraryUi((s) => s.desc);
  const setDesc = useLibraryUi((s) => s.setDesc);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label={t("topbar.sort_by")}>
          {desc ? <ArrowDownWideNarrow size={18} /> : <ArrowUpNarrowWide size={18} />}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[220px] rounded-[18px] border border-hairline bg-surface-2 p-1.5 shadow-popover"
        >
          <DropdownMenu.Label className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ttertiary">
            {t("topbar.sort_by")}
          </DropdownMenu.Label>
          {SORTS.map((s) => (
            <DropdownMenu.Item
              key={s.key}
              onSelect={() => setSort(s.key)}
              className="flex h-10 cursor-default items-center gap-3 rounded-[12px] px-3 text-sm text-tsecondary outline-none transition-colors data-[highlighted]:bg-white/[.07] data-[highlighted]:text-tprimary"
            >
              <Check size={15} className={cn(sort === s.key ? "opacity-100" : "opacity-0")} />
              {t(s.labelKey)}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-hairline" />
          <DropdownMenu.Item
            onSelect={() => setDesc(false)}
            className="flex h-10 cursor-default items-center gap-3 rounded-[12px] px-3 text-sm text-tsecondary outline-none transition-colors data-[highlighted]:bg-white/[.07] data-[highlighted]:text-tprimary"
          >
            <ArrowUpNarrowWide
              size={15}
              className={cn(!desc ? "opacity-100" : "opacity-0")}
            />
            {t("topbar.ascending")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setDesc(true)}
            className="flex h-10 cursor-default items-center gap-3 rounded-[12px] px-3 text-sm text-tsecondary outline-none transition-colors data-[highlighted]:bg-white/[.07] data-[highlighted]:text-tprimary"
          >
            <ArrowDownWideNarrow size={15} className={cn(desc ? "opacity-100" : "opacity-0")} />
            {t("topbar.descending")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
