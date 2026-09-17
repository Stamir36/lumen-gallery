import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Film,
  FolderTree as FolderTreeIcon,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Images,
  Layers,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { SidebarRail, type SidebarItem } from "@/components/ui/SidebarRail";
import { LanguageDropdown, LanguageDropdownIcon } from "@/components/LanguageSwitcher";
import { NavTooltip } from "@/components/ui/NavTooltip";
import { IconButton } from "@/components/ui/IconButton";
import { Onboarding } from "@/pages/Onboarding";
import { LibraryTopBar } from "@/components/library/LibraryTopBar";
import { MediaGrid } from "@/components/library/MediaGrid";
import { FolderShelf } from "@/components/library/FolderCards";
import { StatusLine } from "@/components/library/StatusLine";
import { ViewModeSwitch } from "@/components/library/ViewModeSwitch";
import { BrowseModeSwitch } from "@/components/library/BrowseModeSwitch";
import { FolderTree } from "@/components/library/FolderTree";
import { formatBytes, formatCount } from "@/lib/api";
import { useLibrarySummary, useMediaRows } from "@/lib/queries";
import { useRootsStore, useScanStore } from "@/state/library";
import { filterForRoute, useLibraryUi, type SmartView } from "@/state/library-ui";
import { getDb } from "@/lib/db";
import { useAppSettings } from "@/lib/settings";

/** Every "Add library" entry point resets the onboarding state machine. */
function useOpenOnboarding() {
  const resetToPicker = useScanStore((s) => s.resetToPicker);
  const [show, setShow] = useState(false);
  const open = () => {
    resetToPicker();
    setShow(true);
  };
  return { show, open, close: () => setShow(false) };
}

const SMART_ITEMS: { id: SmartView; labelKey: string; icon: React.ReactNode }[] = [
  { id: "all", labelKey: "sidebar.all", icon: <Images /> },
  { id: "images", labelKey: "sidebar.images", icon: <ImageIcon /> },
  { id: "videos", labelKey: "sidebar.videos", icon: <Film /> },
  { id: "favorites", labelKey: "sidebar.favorites", icon: <Heart /> },
  { id: "albums", labelKey: "sidebar.albums", icon: <Layers /> },
  { id: "recents", labelKey: "sidebar.recents", icon: <Clock /> },
  { id: "trash", labelKey: "sidebar.trash", icon: <Trash2 /> },
];

/**
 * Library shell (Phase 3): sidebar routing + topbar + virtualized grid +
 * mono status line. Onboarding still owns the no-roots case.
 */
export default function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roots, loaded, load, rescan } = useRootsStore();
  const { scanningRootId, done, added, lastScanAt } = useScanStore();
  const onboarding = useOpenOnboarding();
  const [ready, setReady] = useState(false);

  const route = useLibraryUi((s) => s.route);
  const setRoute = useLibraryUi((s) => s.setRoute);
  const openRoot = useLibraryUi((s) => s.openRoot);
  const chip = useLibraryUi((s) => s.chip);
  const q = useLibraryUi((s) => s.q);
  const sort = useLibraryUi((s) => s.sort);
  const desc = useLibraryUi((s) => s.desc);
  const foldersView = useLibraryUi((s) => s.foldersView);
  const browse = useLibraryUi((s) => s.browse);
  /** explorer = file manager: folder tree + only the open folder's contents */
  const explorer = browse === "explorer";

  useEffect(() => {
    (async () => {
      const t0 = performance.now();
      try {
        await getDb(); // runs migrations
      } catch (e) {
        console.error("db load failed", e);
      }
      const t1 = performance.now();
      await load();
      const t2 = performance.now();
      // hover scrub speed etc. — read once, before the grid can hover anything
      void useAppSettings.getState().load();
      setReady(true);
      // dev-only numbers: "the app hangs on open" needs data, not guesses
      if (import.meta.env.DEV) {
        console.info(
          `[perf] boot: db ${Math.round(t1 - t0)}ms · roots ${Math.round(
            t2 - t1,
          )}ms · total ${Math.round(t2 - t0)}ms`,
        );
      }
    })();
  }, [load]);

  // alt+← = up one folder level (STEP 3B)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        const ui = useLibraryUi.getState();
        const r = ui.route;
        const path =
          r.kind === "root"
            ? useRootsStore.getState().roots.find((x) => x.id === r.rootId)?.path
            : undefined;
        ui.goUp(path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // explorer mode always needs a folder: fall back to the first library
  useEffect(() => {
    if (browse === "explorer" && route.kind !== "root" && roots.length > 0) {
      openRoot(roots[0].id);
    }
  }, [browse, route, roots, openRoot]);

  const summary = useLibrarySummary(ready);
  const noRoots = loaded && roots.length === 0;
  const root = route.kind === "root" ? roots.find((r) => r.id === route.rootId) : undefined;

  // folder routes: "folders" scope lists the current directory only
  const dir =
    route.kind === "root"
      ? explorer || foldersView
        ? (route.dir ?? root?.path ?? null)
        : null
      : null;

  // albums are DB-only collections (Phase 5): no rows to query yet
  const enabled =
    ready &&
    roots.length > 0 &&
    !onboarding.show &&
    (route.kind !== "root" || root !== undefined) &&
    !(route.kind === "smart" && route.id === "albums");

  const params = useMemo(
    () => ({
      filter: filterForRoute(route, chip),
      sort: route.kind === "smart" && route.id === "recents" ? ("added" as const) : sort,
      desc: route.kind === "smart" && route.id === "recents" ? true : desc,
      q,
      rootId: route.kind === "root" ? route.rootId : null,
      dir,
      enabled,
    }),
    [route, chip, sort, desc, q, dir, enabled],
  );

  const media = useMediaRows(params);
  const rows = media.data ?? [];

  const items: SidebarItem[] = [
    ...roots.map((r) => ({
      id: `root-${r.id}`,
      label: r.label || r.path,
      icon: <HardDrive />,
      badge: r.itemCount ? formatCount(r.itemCount) : undefined,
      active: route.kind === "root" && route.rootId === r.id,
      onSelect: () => openRoot(r.id),
      capacity:
        r.totalBytes > 0
          ? {
              ratio: (r.totalBytes - r.availableBytes) / r.totalBytes,
              caption: `${formatBytes(r.availableBytes)} free / ${formatBytes(r.totalBytes)}`,
            }
          : undefined,
      action: {
        label: t("sidebar.rescan", { label: r.label || r.path }),
        icon: <RefreshCw />,
        onClick: () => void rescan(r.id),
      },
    })),
    // discoverable entry into the folder shelf of the active root (FIX 5):
    // clicking a drive still opens it, this makes the mode obvious
    ...(roots.length > 0
      ? [
          {
            id: "folders",
            label: t("sidebar.folders"),
            icon: <FolderTreeIcon />,
            active: route.kind === "root" && foldersView,
            onSelect: () => {
              const target = route.kind === "root" ? route.rootId : roots[0]?.id;
              if (target !== undefined) openRoot(target);
            },
          } satisfies SidebarItem,
        ]
      : []),
    ...SMART_ITEMS.map((s) => {
      const badge =
        s.id === "all"
          ? summary.data?.total
          : s.id === "images"
            ? summary.data?.images
            : s.id === "videos"
              ? summary.data?.videos
              : s.id === "favorites"
                ? summary.data?.favorites
                : undefined;
      return {
        id: s.id,
        label: t(s.labelKey),
        icon: s.icon,
        badge: badge ? formatCount(badge) : undefined,
        active: route.kind === "smart" && route.id === s.id,
        onSelect: () => setRoute({ kind: "smart", id: s.id }),
      };
    }),
  ];

  const title = t(
    route.kind === "root"
      ? "sidebar.library"
      : `sidebar.${route.id === "images" ? "images" : route.id}`,
  );

  const emptyKind = q.trim()
    ? ("search" as const)
    : route.kind === "smart" &&
        (route.id === "favorites" || route.id === "trash" || route.id === "albums")
      ? route.id
      : ("media" as const);

  const scanText = `${t("scan_progress.scanning")} ${t("scan_progress.seen_added", {
    done: formatCount(done),
    added: formatCount(added),
  })}`;

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar
        leftAction={<span className="font-mono text-xs text-ttertiary">v0.1</span>}
        // only on library routes: the onboarding shell has no grid to switch
        right={
          !noRoots && !onboarding.show ? (
            <div className="flex items-center gap-2">
              <BrowseModeSwitch />
              <ViewModeSwitch />
            </div>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1">
        {!noRoots && (
          <SidebarRail
            items={items}
            bottom={
              <div className="flex flex-col gap-3">
                <LanguageDropdown />
                <button
                  onClick={onboarding.open}
                  className="flex h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] hover:bg-white/[.06] hover:text-tprimary"
                >
                  <Plus size={18} />
                  {t("sidebar.add_library")}
                </button>
                <button
                  onClick={() => navigate("/settings")}
                  className="flex h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] hover:bg-white/[.06] hover:text-tprimary"
                >
                  <Settings size={18} />
                  {t("sidebar.settings")}
                </button>
                <div className="px-3 font-mono text-[10px] leading-relaxed text-ttertiary">
                  {scanningRootId !== null
                    ? scanText
                    : t("sidebar.items_summary", {
                        count: formatCount(summary.data?.total ?? 0),
                        size: formatBytes(summary.data?.bytes ?? 0),
                      })}
                </div>
              </div>
            }
            railBottom={
              <>
                <LanguageDropdownIcon />
                <NavTooltip label={t("sidebar.add_library")}>
                  <IconButton label={t("sidebar.add_library")} onClick={onboarding.open}>
                    <Plus size={18} />
                  </IconButton>
                </NavTooltip>
                <NavTooltip label={t("sidebar.settings")}>
                  <IconButton
                    label={t("sidebar.settings")}
                    onClick={() => navigate("/settings")}
                  >
                    <Settings size={18} />
                  </IconButton>
                </NavTooltip>
              </>
            }
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {noRoots || onboarding.show ? (
            <Onboarding onDone={onboarding.close} />
          ) : (
            <>
              <LibraryTopBar title={title} count={rows.length} />
              <div className="relative flex min-h-0 flex-1">
                {explorer && route.kind === "root" && root && (
                  <FolderTree
                    rootId={root.id}
                    rootPath={root.path}
                    rootLabel={root.label || root.path}
                    className="w-[264px] shrink-0 border-r border-hairline bg-surface-1"
                  />
                )}
                <div className="relative min-h-0 min-w-0 flex-1">
                  <MediaGrid
                    rows={rows}
                    pending={media.isPending}
                    error={media.error}
                    query={q}
                    emptyKind={emptyKind}
                    onRetry={() => void media.refetch()}
                    onAddLibrary={onboarding.open}
                    folderZone={
                      !explorer && route.kind === "root" && foldersView && root ? (
                        <FolderShelf
                          rootId={root.id}
                          dir={route.dir}
                          enabled={route.dir !== null || root.path.length > 0}
                        />
                      ) : undefined
                    }
                  />
                </div>
              </div>
              <StatusLine
                summary={summary.data}
                lastScanAt={lastScanAt}
                scanning={scanningRootId !== null}
                scanText={scanText}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
