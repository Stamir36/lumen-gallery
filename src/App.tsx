import { useEffect, useMemo, useRef, useState } from "react";
import { readSetting, writeSetting } from "@/i18n";
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
import { SetupWizard } from "@/pages/SetupWizard";
import { LibraryTopBar, RailTitlebarCenter } from "@/components/library/LibraryTopBar";
import { RailShell } from "@/components/library/RailShell";
import { MediaGrid } from "@/components/library/MediaGrid";
import { FolderGrid } from "@/components/library/FolderCards";
import { StatusLine } from "@/components/library/StatusLine";
import { ViewModeSwitch } from "@/components/library/ViewModeSwitch";
import { BrowseModeSwitch } from "@/components/library/BrowseModeSwitch";
import { FolderTree } from "@/components/library/FolderTree";
import { ViewerOverlay } from "@/components/viewer/ViewerOverlay";
import { ContextMenuHost } from "@/components/ui/ContextMenu";
import { HotkeySheet } from "@/components/HotkeySheet";
import { formatBytes, formatCount } from "@/lib/api";
import { waitBackendReady } from "@/lib/backend";
import { startThumbBridge } from "@/lib/thumbs";
import { useLibrarySummary, useMediaRows } from "@/lib/queries";
import { useRootsStore, useScanStore } from "@/state/library";
import { filterForRoute, useLibraryUi, type SmartView } from "@/state/library-ui";
import { getDb } from "@/lib/db";
import { useAppSettings } from "@/lib/settings";
import { syncVideoFilterFromStore } from "@/lib/colorCorrection";
import appIcon from "../assets/icon.svg";

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
  // F7: Albums stay out of the sidebar until Phase 5 ships real collections —
  // a smart view that silently re-lists "All media" reads as a bug, not a feature
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
  // B2: individual selectors — the whole-store subscription re-rendered the entire
  // shell (grid included) on EVERY scan-progress event, i.e. per walked file.
  const scanningRootId = useScanStore((s) => s.scanningRootId);
  const done = useScanStore((s) => s.done);
  const added = useScanStore((s) => s.added);
  const lastScanAt = useScanStore((s) => s.lastScanAt);
  const onboarding = useOpenOnboarding();
  const [ready, setReady] = useState(false);
  // null = the first-run flag has not been read yet (never flash the wizard)
  const [setupSeen, setSetupSeen] = useState<boolean | null>(null);

  const route = useLibraryUi((s) => s.route);
  const setRoute = useLibraryUi((s) => s.setRoute);
  const openRoot = useLibraryUi((s) => s.openRoot);
  const chip = useLibraryUi((s) => s.chip);
  const q = useLibraryUi((s) => s.q);
  const sort = useLibraryUi((s) => s.sort);
  const desc = useLibraryUi((s) => s.desc);
  const foldersView = useLibraryUi((s) => s.foldersView);
  const browse = useLibraryUi((s) => s.browse);
  const explorerLayout = useLibraryUi((s) => s.explorerLayout);
  // P4: classic (sidebar + library bar) or rail (header + 64px icon rail)
  const mainLayout = useAppSettings((s) => s.mainLayout);
  const uiMotion = useAppSettings((s) => s.uiMotion);
  const rail = mainLayout === "rail";
  /** explorer = file manager: folder tree + only the open folder's contents */
  const explorer = browse === "explorer";

  useEffect(() => {
    (async () => {
      const t0 = performance.now();
      // writer task + asset scope + watchers must exist before the first query
      // (S1.10): without this the grid raced migrations and the asset scope,
      // which is where the first-open flicker came from
      const backend = await waitBackendReady();
      const t1 = performance.now();
      try {
        await getDb(); // runs migrations
      } catch (e) {
        console.error("db load failed", e);
      }
      const t2 = performance.now();
      await load();
      const t3 = performance.now();
      // hover scrub speed etc. — read once, before the grid can hover anything;
      // P7 F4: then restore the persisted video color correction onto :root
      void useAppSettings.getState().load().then(syncVideoFilterFromStore);
      // one subscription for thumb results + durability pushes (S1.3)
      startThumbBridge();
      setReady(true);
      // dev-only numbers: "the app hangs on open" needs data, not guesses
      if (import.meta.env.DEV) {
        console.info(
          `[perf] boot: backend ${backend ? Math.round(t1 - t0) : "timeout " + Math.round(t1 - t0)}ms · ` +
            `db ${Math.round(t2 - t1)}ms · roots ${Math.round(t3 - t2)}ms · ` +
            `total ${Math.round(t3 - t0)}ms`,
        );
      }
    })();
  }, [load]);

  // First-run personalization: the wizard opens ONCE, and only for someone who
  // already has a library (before that, adding a library IS the first step).
  useEffect(() => {
    let alive = true;
    void readSetting("setup_completed")
      .then((v) => alive && setSetupSeen(v === "true"))
      .catch(() => alive && setSetupSeen(true)); // no backend → don't nag
    return () => {
      alive = false;
    };
  }, []);

  const finishSetup = async () => {
    setSetupSeen(true);
    try {
      await writeSetting("setup_completed", "true");
    } catch {
      /* browser QA — the flag is best-effort */
    }
  };

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

  // Switching INTO the explorer opens the first library — but only at the moment
  // of the switch: smart views must keep working afterwards instead of bouncing
  // the user back to a folder.
  const lastBrowse = useRef(browse);
  useEffect(() => {
    if (lastBrowse.current === browse) return;
    lastBrowse.current = browse;
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

  // ---------- view change motion (P9) ----------
  // Every navigation (smart view ⇄ library ⇄ folders ⇄ explorer) re-runs a
  // 140ms rise on the grid host. The class is toggled on a ref, so the
  // virtualized list is NOT remounted — the animation rides on top.
  const viewKey = `${route.kind}:${route.kind === "smart" ? route.id : route.rootId}:${foldersView}:${explorer}`;
  const gridHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = gridHost.current;
    if (!el || !uiMotion) return;
    el.classList.remove("view-in");
    void el.offsetWidth; // force a reflow so the animation restarts
    el.classList.add("view-in");
    const timer = window.setTimeout(() => el.classList.remove("view-in"), 220);
    return () => window.clearTimeout(timer);
  }, [viewKey, uiMotion]);

  // `ready` guard: never flash the wizard over a library that is still loading
  const showWizard = ready && setupSeen === false && roots.length > 0 && !onboarding.show;

  // FIX: nav rows route change while the "Add library" onboarding was open —
  // the grid behind it DID switch, but the onboarding sheet stayed on top and
  // it looked like nothing happened. Any explicit navigation leaves onboarding.
  const closeOnboarding = onboarding.show ? onboarding.close : undefined;
  const selectAndLeave = (go: () => void) => {
    closeOnboarding?.();
    go();
  };

  const items: SidebarItem[] = [
    ...roots.map((r) => ({
      id: `root-${r.id}`,
      label: r.label || r.path,
      icon: <HardDrive />,
      badge: r.itemCount ? formatCount(r.itemCount) : undefined,
      active: route.kind === "root" && route.rootId === r.id,
      onSelect: () => selectAndLeave(() => openRoot(r.id)),
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
              if (target !== undefined) selectAndLeave(() => openRoot(target));
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
        onSelect: () => selectAndLeave(() => setRoute({ kind: "smart", id: s.id })),
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

  /** The grid area is IDENTICAL in both layouts — one query, one engine. */
  const gridArea = (
    <div className="relative flex min-h-0 flex-1">
      {explorer && explorerLayout === "tree" && route.kind === "root" && root && (
        <FolderTree
          rootId={root.id}
          rootPath={root.path}
          rootLabel={root.label || root.path}
          className="w-[264px] shrink-0 border-r border-hairline bg-surface-1"
        />
      )}
      <div ref={gridHost} className="relative min-h-0 min-w-0 flex-1">
        <MediaGrid
          rows={rows}
          pending={media.isPending}
          error={media.error}
          query={q}
          emptyKind={emptyKind}
          onRetry={() => void media.refetch()}
          onAddLibrary={onboarding.open}
          /* gallery = PURE flat date-grouped feed (no folder cards —
             the explorer owns folders). In the explorer the two
             sub-layouts are mutually exclusive (S1.9): TREE renders
             the tree on the left and nothing above the contents,
             GRID renders wrapping folder cards and no tree. */
          folderZone={
            explorer && explorerLayout === "grid" && route.kind === "root" && root ? (
              <FolderGrid
                rootId={root.id}
                dir={route.dir}
                enabled={route.dir !== null || root.path.length > 0}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );

  /** icon-only footer shared by the classic rail and the rail layout */
  const railBottom = (
    <>
      <LanguageDropdownIcon />
      <NavTooltip label={t("sidebar.add_library")}>
        <IconButton label={t("sidebar.add_library")} onClick={onboarding.open}>
          <Plus size={18} />
        </IconButton>
      </NavTooltip>
      <NavTooltip label={t("sidebar.settings")}>
        <IconButton label={t("sidebar.settings")} onClick={() => navigate("/settings")}>
          <Settings size={18} />
        </IconButton>
      </NavTooltip>
    </>
  );

  // FIRST-RUN TAKE-OVER: the wizard is a full screen, not a panel — the
  // sidebar, the library bar and the view switches all belong to a library
  // that does not exist yet, and drawing them behind the wizard made the app
  // look like it had already opened (user report). Only the titlebar survives,
  // because the window is frameless: without it there is nothing to drag or
  // close.
  if (showWizard) {
    return (
      <div className="flex h-full flex-col">
        <WindowTitleBar
          // the app mark instead of the default hamburger: in a take-over
          // screen a decorative menu glyph is a dead affordance
          leftAction={
            <img
              src={appIcon}
              alt=""
              aria-hidden
              width={20}
              height={20}
              draggable={false}
              className="rounded-[6px]"
            />
          }
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SetupWizard onDone={() => void finishSetup()} />
        </main>
        <ContextMenuHost />
      </div>
    );
  }

  const statusBar = (
    <StatusLine
      summary={summary.data}
      lastScanAt={lastScanAt}
      scanning={scanningRootId !== null}
      scanText={scanText}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar
        // BUGS 29.09: the hard-coded v0.1 is gone — the titlebar now carries
        // the app mark + a quiet version pill (see WindowTitleBar).
        leftAction={undefined}
        // F4 — rail mode: the library controls live IN the titlebar so the
        // screen shows exactly ONE header. Classic keeps the full GlassTopBar.
        center={
          rail && !noRoots && !onboarding.show ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <RailTitlebarCenter />
            </div>
          ) : undefined
        }
        // only on library routes: the onboarding shell has no grid to switch
        /* titlebar right (FIX 5): mode toggle FIRST, then view-mode icons */
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
        {!noRoots && !rail && (
          <SidebarRail
            items={items}
            bottom={
              <div className="flex flex-col gap-0.5">
                <LanguageDropdown />
                <button
                  onClick={onboarding.open}
                  className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] hover:bg-white/[.06] hover:text-tprimary"
                >
                  <Plus size={18} />
                  {t("sidebar.add_library")}
                </button>
                <button
                  onClick={() => navigate("/settings")}
                  className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] hover:bg-white/[.06] hover:text-tprimary"
                >
                  <Settings size={18} />
                  {t("sidebar.settings")}
                </button>
                <div className="px-3 pt-1 font-mono text-[10px] leading-relaxed text-ttertiary">
                  {scanningRootId !== null
                    ? scanText
                    : t("sidebar.items_summary", {
                        count: formatCount(summary.data?.total ?? 0),
                        size: formatBytes(summary.data?.bytes ?? 0),
                      })}
                </div>
              </div>
            }
            railBottom={railBottom}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {noRoots || onboarding.show ? (
            <Onboarding onDone={onboarding.close} />
          ) : rail ? (
            <RailShell
              title={title}
              count={rows.length}
              items={items}
              railBottom={railBottom}
              status={statusBar}
            >
              {gridArea}
            </RailShell>
          ) : (
            <>
              <LibraryTopBar
                title={title}
                count={rows.length}
                // F15: the tree/cards switch lives ONLY in the window titlebar
                // now — a second identical toggle in the library bar was a
                // duplicate control on the same screen.
              />
              {gridArea}
              {statusBar}
            </>
          )}
        </main>
      </div>
      {/* viewer: portal, so nothing underneath re-renders (STEP 3) */}
      <ViewerOverlay />
      <ContextMenuHost />
      {/* P6: "?" — one panel, every shortcut, grouped by surface */}
      <HotkeySheet />
    </div>
  );
}
