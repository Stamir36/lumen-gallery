import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Film, Heart, Image as ImageIcon, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/Segmented";
import { NavTooltip } from "@/components/ui/NavTooltip";
import type { SidebarItem } from "@/components/ui/SidebarRail";
import { useLibraryUi, type SmartView } from "@/state/library-ui";
import { useRootsStore } from "@/state/library";
import { Breadcrumbs } from "./Breadcrumbs";

/**
 * The fast views the chips panel exposes. "recents" rides along: it is one tap
 * from the same row, and leaving it in the rail only would put a destination
 * behind a hover.
 */
const CHIPS: { id: SmartView; labelKey: string; icon: React.ReactNode }[] = [
  { id: "all", labelKey: "sidebar.all", icon: <Images size={15} /> },
  { id: "images", labelKey: "sidebar.images", icon: <ImageIcon size={15} /> },
  { id: "videos", labelKey: "sidebar.videos", icon: <Film size={15} /> },
  { id: "favorites", labelKey: "sidebar.favorites", icon: <Heart size={15} /> },
  { id: "recents", labelKey: "sidebar.recents", icon: <Clock size={15} /> },
];

/**
 * F4 — the RAIL main layout, ONE header edition.
 *
 * The window titlebar hosts the search and the mode controls (passed in from
 * App as the titlebar `center` slot), so the screen carries exactly ONE header
 * and ONE "LUMEN" mark in rail mode — the duplicate floating header panel is
 * gone. What remains here:
 *
 *   ┌── titlebar: LUMEN · v0.1 · [search · sort · view · select] · controls ──┐
 *   ┌──────┐  ┌──────────────────────────────────────────────┐
 *   │ rail │  │ chips: Все · Фото · Видео · Избранное · Недавние │
 *   │  ○   │  ├──────────────────────────────────────────────┤
 *   │  ○   │  │ grid (classic engine: justified/masonry/list, sticky dates) │
 *   │  ○   │  └──────────────────────────────────────────────┘
 *   └──────┘
 *
 * The rail is ONE floating panel (radius 20, 12px margin — the user sketch):
 * 40px icon hit areas, small mono count chip under the icon, active item =
 * accent tint + accent icon + a 2px accent bar on the panel's left edge, mono
 * tooltips. The search field keeps its "/" hotkey contract here.
 */
export function RailShell({
  title,
  count,
  items,
  railBottom,
  status,
  search,
  children,
}: {
  title: string;
  count: number;
  /** destinations for the rail — the same items the classic sidebar renders */
  items: SidebarItem[];
  railBottom?: React.ReactNode;
  /** the mono status line, pinned under the grid */
  status?: React.ReactNode;
  /** the search field React node, rendered by App inside the window titlebar */
  search: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const route = useLibraryUi((s) => s.route);
  const setRoute = useLibraryUi((s) => s.setRoute);
  const q = useLibraryUi((s) => s.q);
  const roots = useRootsStore((s) => s.roots);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search — the search input is rendered in the titlebar, so the
  // hook walks the DOM instead of a local ref
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "/" && !typing) {
        const input = document.querySelector<HTMLInputElement>(
          "[data-rail-search] input, input[data-rail-search]",
        );
        input?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  void searchRef;
  void search;

  const root = route.kind === "root" ? roots.find((r) => r.id === route.rootId) : undefined;
  // no matching chip (a root route, albums, trash) → nothing is highlighted
  const activeChip: SmartView | null =
    route.kind === "smart" && CHIPS.some((c) => c.id === route.id) ? route.id : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* ---------- body: rail panel + content column ---------- */}
      <div className="flex min-h-0 flex-1 gap-3">
        <nav
          aria-label={t("rail.nav")}
          className="relative flex w-[64px] shrink-0 flex-col items-center gap-1 overflow-hidden rounded-[20px] bg-surface-1 py-3"
        >
          {/* the 2px accent bar marks the panel the keyboard/mouse is on (sketch) */}
          {items.some((i) => i.active) && (
            <span className="absolute left-0 top-1/2 h-10 w-0.5 -translate-y-1/2 rounded-pill bg-accent" />
          )}
          <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
            {items.map((item) => (
              <NavTooltip key={item.id} label={item.label} mono side="right">
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={item.active ? "page" : undefined}
                  onClick={item.onSelect}
                  className={cn(
                    "relative flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-[12px] transition-all duration-[160ms] ease-out active:scale-[.97]",
                    item.active
                      ? "bg-accent/[.16] text-accent"
                      : "text-tsecondary hover:bg-white/[.07] hover:text-tprimary",
                  )}
                >
                  <span className="flex h-[18px] w-[18px] items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">
                    {item.icon}
                  </span>
                  {item.badge && (
                    <span className="pointer-events-none font-mono text-[8.5px] leading-none tabular-nums text-ttertiary">
                      {item.badge}
                    </span>
                  )}
                </button>
              </NavTooltip>
            ))}
          </div>
          {railBottom && <div className="flex flex-col items-center gap-1 pt-2">{railBottom}</div>}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* chips panel: the fast filter, plus the editorial "where am I" line */}
          <div className="flex h-14 shrink-0 items-center gap-4 rounded-[20px] bg-surface-1 px-4">
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

          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[20px]">
            {children}
          </div>
          {status}
        </div>
      </div>
    </div>
  );
}
