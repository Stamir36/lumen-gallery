import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Heart,
  Images,
  Film,
  Clock,
  Trash2,
  HardDrive,
  RefreshCw,
  Plus,
  Settings,
} from "lucide-react";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { SidebarRail, type SidebarItem } from "@/components/ui/SidebarRail";
import { LanguageDropdown, LanguageDropdownIcon } from "@/components/LanguageSwitcher";
import { NavTooltip } from "@/components/ui/NavTooltip";
import { IconButton } from "@/components/ui/IconButton";
import { Onboarding } from "@/pages/Onboarding";
import { api, formatBytes, formatCount } from "@/lib/api";
import { useRootsStore, useScanStore } from "@/state/library";

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
import { getDb } from "@/lib/db";
import { useNavigate } from "react-router-dom";

/**
 * App shell after Phase 2: frameless TitleBar + roots sidebar + onboarding.
 * The grid lands in Phase 3; this proves the scan pipeline end to end.
 */
export default function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roots, loaded, load, rescan, remove } = useRootsStore();
  const { scanningRootId, done, added } = useScanStore();
  const [stats, setStats] = useState<[number, number]>([0, 0]);
  const onboarding = useOpenOnboarding();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await getDb(); // runs migrations v1
      } catch (e) {
        console.error("db load failed", e);
      }
      await load();
      setReady(true);
    })();
  }, [load]);

  useEffect(() => {
    if (!ready) return;
    api.libraryStats().then(setStats).catch(() => setStats([0, 0]));
  }, [ready, scanningRootId]);

  const noRoots = loaded && roots.length === 0;

  const items: SidebarItem[] = [
    ...roots.map((r) => ({
      id: `root-${r.id}`,
      label: r.label || r.path,
      icon: <HardDrive />,
      badge: r.itemCount ? formatCount(r.itemCount) : undefined,
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
    { id: "photos", label: t("sidebar.images"), icon: <FolderOpen />, badge: formatCount(stats[0]) },
    { id: "favorites", label: t("sidebar.favorites"), icon: <Heart /> },
    { id: "albums", label: t("sidebar.albums"), icon: <Images /> },
    { id: "videos", label: t("sidebar.videos"), icon: <Film /> },
    { id: "recents", label: t("sidebar.recents"), icon: <Clock /> },
    { id: "trash", label: t("sidebar.trash"), icon: <Trash2 /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar
        leftAction={<span className="font-mono text-xs text-ttertiary">v0.1</span>}
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
                    ? `${t("scan_progress.scanning")} ${t("scan_progress.seen_added", {
                        done: formatCount(done),
                        added: formatCount(added),
                      })}`
                    : t("sidebar.items_summary", {
                        count: formatCount(stats[0]),
                        size: formatBytes(stats[1]),
                      })}
                </div>
              </div>
            }
            railBottom={
              <>
                <LanguageDropdownIcon />
                <NavTooltip label={t("sidebar.add_library")}>
                  <IconButton
                    label={t("sidebar.add_library")}
                    onClick={onboarding.open}
                  >
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

        <main className="min-w-0 flex-1 overflow-hidden">
          {noRoots || onboarding.show ? (
            <Onboarding onDone={onboarding.close} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6 px-10">
              <h1 className="text-4xl font-bold tracking-tight text-tprimary">
                {t("sidebar.library")}
              </h1>
              <p className="max-w-md text-center text-[15px] text-tsecondary">
                {t("empty_states.library_summary", {
                  roots: `${roots.length}`,
                  count: formatCount(stats[0]),
                })}
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                {roots.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-4 rounded-card bg-surface-1 px-6 py-5 shadow-elev1"
                  >
                    <HardDrive size={20} className="text-tsecondary" />
                    <div>
                      <div className="text-sm font-medium text-tprimary">
                        {r.label || r.path}
                      </div>
                      <div className="font-mono text-[11px] text-ttertiary">
                        {formatCount(r.itemCount)}
                      </div>
                    </div>
                    <IconButton
                      label={t("actions.rescan_root")}
                      onClick={() => rescan(r.id)}
                      disabled={scanningRootId !== null}
                    >
                      <RefreshCw size={16} />
                    </IconButton>
                    <IconButton
                      label={t("actions.remove_root")}
                      className="text-danger"
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}


