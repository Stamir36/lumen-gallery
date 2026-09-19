import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Film, Heart, Image as ImageIcon, Images, Search, SquareCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/api";
import { Segmented } from "@/components/ui/Segmented";
import { IconButton } from "@/components/ui/IconButton";
import { NavTooltip } from "@/components/ui/NavTooltip";
import type { SidebarItem } from "@/components/ui/SidebarRail";
import { useLibraryUi, type SmartView } from "@/state/library-ui";
import { useRootsStore } from "@/state/library";
import { Breadcrumbs } from "./Breadcrumbs";
import { SortMenu } from "./LibraryTopBar";
import { ViewModeSwitch } from "./ViewModeSwitch";

/** The four smart views the chips row exposes (P4 sketch). */
const CHIPS: { id: SmartView; labelKey: string; icon: React.ReactNode }[] = [
  { id: "all", labelKey: "sidebar.all", icon: <Images size={15} /> },
  { id: "images", labelKey: "sidebar.images", icon: <ImageIcon size={15} /> },
  { id: "videos", labelKey: "sidebar.videos", icon: <Film size={15} /> },
  { id: "favorites", labelKey: "sidebar.favorites", icon: <Heart size={15} /> },
  // recents is one chip away from the same rail — the sidebar groups it there
  { id: "recents", labelKey: "sidebar.recents", icon: <Clock size={15} /> },
];

/**
 * P4 — the RAIL main layout. Same engine as the classic shell (one grid, one
 * query, one status line), different arrangement:
 *
 *   [ header: LUMEN · search (flex-1) · sort / view / selection ]
 *   [ chips row: Все · Фото · Видео · Избранное + breadcrumbs ]
 *   [ 64px rail ] [ grid, justified gutters, sticky date headers unchanged ]
 *
 * The rail is PERMANENT (no collapse): it carries destinations only, so it can
 * stay icon-only with mono tooltips — leaving the full width to the grid.
 * Structural chrome is solid surface-1 + editorial hairline (DESIGN v2.4 §3.2);
 * the active row is one of the 3–5 accent anchors per screen (§3.3).
 */
export function RailShell({
  title,
  count,
  items,
  railBottom,
  extra,
  status,
  children,
}: {
  title: string;
  count: number;
  /** destinations for the rail — the same items the classic sidebar renders */
  items: SidebarItem[];
  railBottom?: React.ReactNode;
  /** mode-specific control for the header (explorer tree|grid) */
  extra?: React.ReactNode;
  /** the mono status line, pinned under the grid */
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const route = useLibraryUi((s) => s.route);
  const setRoute = useLibraryUi((s) => s.setRoute);
  const q = useLibraryUi((s) => s.q);
  const setQ = useLibraryUi((s) => s.setQ);
  const selectionMode = useLibraryUi((s) => s.selectionMode);
  const toggleSelectionMode = useLibraryUi((s) => s.toggleSelectionMode);
  const roots = useRootsStore((s) => s.roots);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search — same contract as the classic bar
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
  // no matching chip (a root route, albums, trash) → nothing is highlighted
  const activeChip: SmartView | null =
    route.kind === "smart" && CHIPS.some((c) => c.id === route.id) ? route.id : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---------- permanent icon rail (64px) ---------- */}
      <nav
        aria-label={t("rail.nav")}
        className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-surface-1 py-3"
      >
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {items.map((item) => (
            <NavTooltip key={item.id} label={item.label} mono side="right">
              <button
                type="button"
                aria-label={item.label}
                aria-current={item.active ? "page" : undefined}
                onClick={item.onSelect}
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center rounded-control transition-all duration-[160ms] ease-out active:scale-[.97]",
                  item.active
                    ? "bg-accent/[.14] text-accent"
                    : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
                )}
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">
                  {item.icon}
                </span>
                {item.badge && (
                  <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded-[5px] bg-canvas px-1 font-mono text-[9px] tabular-nums text-ttertiary">
                    {item.badge}
                  </span>
                )}
              </button>
            </NavTooltip>
          ))}
        </div>
        {railBottom && <div className="flex flex-col items-center gap-1 pt-2">{railBottom}</div>}
      </nav>

      {/* ---------- header + chips + content ---------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-hairline bg-surface-1 px-6">
          <div className="flex shrink-0 items-baseline gap-3">
            <span className="text-[20px] leading-none font-[650] tracking-[-0.01em] text-tprimary">
              LUMEN
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ttertiary">
              {formatCount(count)}
            </span>
          </div>

          <div className="relative min-w-0 flex-1">
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
              className="h-11 w-full rounded-pill bg-surface-2 pl-10 pr-10 text-sm text-tprimary outline-none transition-colors duration-[160ms] placeholder:text-ttertiary hover:bg-surface-3 focus:bg-surface-3"
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

          <div className="flex shrink-0 items-center gap-2">
            {extra}
            <SortMenu />
            <ViewModeSwitch />
            <IconButton
              label={t("topbar.selection_mode")}
              aria-pressed={selectionMode}
              onClick={toggleSelectionMode}
              className={cn(selectionMode && "bg-surface-2 text-tprimary")}
            >
              <SquareCheck size={18} />
            </IconButton>
          </div>
        </header>

        {/* chips row: the fast filter the sidebar used to own */}
        <div className="flex h-14 shrink-0 items-center gap-4 border-b border-hairline px-6">
          <Segmented<SmartView>
            aria-label={t("topbar.filters")}
            // null is never equal to a segment value, so nothing is active
            value={activeChip ?? ("" as SmartView)}
            onChange={(v) => setRoute({ kind: "smart", id: v })}
            options={CHIPS.map((c) => ({
              value: c.id,
              label: t(c.labelKey),
              icon: c.icon,
            }))}
          />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {root ? (
              <Breadcrumbs
                rootLabel={root.label || root.path}
                rootPath={root.path}
                dir={route.kind === "root" ? route.dir : null}
                count={count}
              />
            ) : (
              <span className="truncate text-[15px] font-semibold text-tprimary">{title}</span>
            )}
            {q.trim() && (
              <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-ttertiary">
                {t("grid.results", { count })}
              </span>
            )}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">{children}</div>
        {status}
      </div>
    </div>
  );
}
