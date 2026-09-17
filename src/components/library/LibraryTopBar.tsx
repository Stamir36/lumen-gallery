import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  Columns3,
  FolderTree,
  Images,
  LayoutGrid,
  List,
  Rows3,
  Search,
  SquareCheck,
  SquareStack,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, type MediaFilter } from "@/lib/api";
import { Segmented } from "@/components/ui/Segmented";
import { IconButton } from "@/components/ui/IconButton";
import { GlassTopBar } from "@/components/ui/GlassTopBar";
import { useLibraryUi, type SortKey, type ViewMode } from "@/state/library-ui";
import { useRootsStore } from "@/state/library";
import { Breadcrumbs } from "./Breadcrumbs";

const SORTS: { key: SortKey; labelKey: string }[] = [
  { key: "date", labelKey: "topbar.sort_date" },
  { key: "name", labelKey: "topbar.sort_name" },
  { key: "size", labelKey: "topbar.sort_size" },
  { key: "duration", labelKey: "topbar.sort_duration" },
];

const CHIPS: { key: MediaFilter; labelKey: string }[] = [
  { key: "all", labelKey: "chips.all" },
  { key: "images", labelKey: "chips.images" },
  { key: "videos", labelKey: "chips.videos" },
  { key: "favorites", labelKey: "chips.favorites" },
];

export function LibraryTopBar({ title, count }: { title: string; count: number }) {
  const { t } = useTranslation();
  const roots = useRootsStore((s) => s.roots);
  const route = useLibraryUi((s) => s.route);
  const view = useLibraryUi((s) => s.view);
  const setView = useLibraryUi((s) => s.setView);
  const q = useLibraryUi((s) => s.q);
  const setQ = useLibraryUi((s) => s.setQ);
  const chip = useLibraryUi((s) => s.chip);
  const setChip = useLibraryUi((s) => s.setChip);
  const foldersView = useLibraryUi((s) => s.foldersView);
  const setFoldersView = useLibraryUi((s) => s.setFoldersView);
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
  const chipsVisible = route.kind === "root" || route.id === "all";

  const viewOptions: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
    { value: "justified", label: t("topbar.view_justified"), icon: <LayoutGrid size={16} /> },
    { value: "masonry", label: t("topbar.view_masonry"), icon: <Columns3 size={16} /> },
    { value: "square", label: t("topbar.view_square"), icon: <SquareStack size={16} /> },
    { value: "list", label: t("topbar.view_list"), icon: <List size={16} /> },
  ];

  return (
    <>
      <GlassTopBar
        left={
          root ? (
            <Breadcrumbs
              rootLabel={root.label || root.path}
              rootPath={root.path}
              dir={route.kind === "root" ? route.dir : null}
              count={count}
            />
          ) : (
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="truncate text-lg font-semibold text-tprimary">{title}</span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-ttertiary">
                {formatCount(count)}
              </span>
            </div>
          )
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
                className="h-11 w-[240px] rounded-pill bg-surface-2 pl-10 pr-10 text-sm text-tprimary outline-none transition-colors duration-[160ms] placeholder:text-ttertiary hover:bg-surface-3 focus:bg-surface-3"
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

            {route.kind === "root" && (
              <Segmented
                aria-label={t("topbar.folder_scope")}
                value={foldersView ? "folders" : "all"}
                onChange={(v) => setFoldersView(v === "folders")}
                options={[
                  { value: "folders", label: t("topbar.scope_folders"), icon: <FolderTree size={16} /> },
                  { value: "all", label: t("topbar.scope_all"), icon: <Images size={16} /> },
                ]}
              />
            )}

            <SortMenu />

            <Segmented
              aria-label={t("topbar.view_mode")}
              value={view}
              onChange={setView}
              options={viewOptions}
            />

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

      {chipsVisible && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-surface-1 px-9">
          {CHIPS.map((c) => {
            const active = chip === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setChip(c.key)}
                className={cn(
                  "inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] transition-colors duration-[160ms]",
                  active
                    ? "bg-surface-3 text-tprimary"
                    : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
                )}
              >
                {t(c.labelKey)}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[11px] text-ttertiary">
              {q.trim() ? t("grid.results", { count }) : ""}
            </span>
          </div>
        </div>
      )}
    </>
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

/** Small helper kept for future toolbars (Rows3 groups the view modes). */
export const VIEW_ICONS = { Rows3 };
