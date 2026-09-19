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

/**
 * The four smart views the chips row exposes (P4 sketch).
 *
 * "recents" rides along: it is one tap from the same row, and leaving it in the
 * rail only would put a destination behind a hover.
 */
const CHIPS: { id: SmartView; labelKey: string; icon: React.ReactNode }[] = [
  { id: "all", labelKey: "sidebar.all", icon: <Images size={15} /> },
  { id: "images", labelKey: "sidebar.images", icon: <ImageIcon size={15} /> },
  { id: "videos", labelKey: "sidebar.videos", icon: <Film size={15} /> },
  { id: "favorites", labelKey: "sidebar.favorites", icon: <Heart size={15} /> },
  { id: "recents", labelKey: "sidebar.recents", icon: <Clock size={15} /> },
];

/**
 * P4/P9 — the RAIL main layout, rebuilt to the approved sketch: three floating
 * rounded panels on the canvas instead of full-bleed bands split by hairlines.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ LUMEN · search · sort/view/select   (header)   │
 *   └────────────────────────────────────────────────┘
 *   ┌────┐  ┌───────────────────────────────────────┐
 *   │ ○  │  │ Все · Фото · Видео · Избранное        │
 *   │ ○  │  ├───────────────────────────────────────┤
 *   │ ○  │  │ grid, justified gutters, sticky dates │
 *   │ ○  │  │                                       │
 *   └────┘  └───────────────────────────────────────┘
 *
 * Why panels: a 44px rail that runs edge-to-edge with a hairline reads as
 * legacy chrome; the same destinations inside a 26px-radius panel read as the
 * app's own furniture and give the grid back its air (DESIGN v2.5 §3).
 *
 * The rail is PERMANENT (no collapse) and carries destinations only, so it can
 * stay icon-only with mono tooltips — leaving the full width to the grid. The
 * active row is one of the 3–5 accent anchors per screen (§3.3).
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      {/* ---------- header: one wide glass pill ---------- */}
      <header className="glass flex h-16 shrink-0 items-center gap-4 rounded-[26px] px-6 shadow-[0_8px_24px_rgba(0,0,0,.28)]">
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
            className="h-11 w-full rounded-pill bg-white/[.05] pl-10 pr-10 text-sm text-tprimary outline-none transition-colors duration-[160ms] placeholder:text-ttertiary hover:bg-white/[.08] focus:bg-white/[.10]"
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
            className={cn(selectionMode && "bg-white/[.10] text-tprimary")}
          >
            <SquareCheck size={18} />
          </IconButton>
        </div>
      </header>

      {/* ---------- body: rail panel + content column ---------- */}
      <div className="flex min-h-0 flex-1 gap-4">
        <nav
          aria-label={t("rail.nav")}
          className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-[26px] bg-surface-1 py-3"
        >
          <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
            {items.map((item) => (
              <NavTooltip key={item.id} label={item.label} mono side="right">
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={item.active ? "page" : undefined}
                  onClick={item.onSelect}
                  className={cn(
                    "relative flex h-12 w-12 items-center justify-center rounded-pill transition-all duration-[160ms] ease-out active:scale-[.97]",
                    // accent TINT, not a filled accent disc: the chips row and
                    // the grid already carry this screen's accent anchors
                    item.active
                      ? "bg-accent/[.16] text-accent"
                      : "text-tsecondary hover:bg-white/[.07] hover:text-tprimary",
                  )}
                >
                  <span className="flex h-[19px] w-[19px] items-center justify-center [&>svg]:h-[19px] [&>svg]:w-[19px]">
                    {item.icon}
                  </span>
                  {item.badge && (
                    <span className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-[6px] bg-canvas px-1 font-mono text-[9px] tabular-nums text-ttertiary">
                      {item.badge}
                    </span>
                  )}
                </button>
              </NavTooltip>
            ))}
          </div>
          {railBottom && <div className="flex flex-col items-center gap-1.5 pt-2">{railBottom}</div>}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* chips panel: the fast filter the sidebar used to own, plus the
              editorial "where am I" line (breadcrumbs or the section title) */}
          <div className="flex h-14 shrink-0 items-center gap-4 rounded-[22px] bg-surface-1 px-4">
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

          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[26px]">
            {children}
          </div>
          {status}
        </div>
      </div>
    </div>
  );
}
