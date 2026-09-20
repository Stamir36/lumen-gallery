import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, appLogDir, join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Check,
  FolderOpen,
  Languages,
  Palette,
  RefreshCw,
  Trash2,
  Gauge,
  Cpu,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DENSITY_PARAMS, SCRUB_RATES, THUMB_WORKER_OPTIONS, useAppSettings, type GridDensity, type MainLayout } from "@/lib/settings";
import { ACCENTS, DEFAULT_ACCENT, isPresetAccent } from "@/lib/accent";
import { ExcludedFolders } from "@/components/settings/ExcludedFolders";
import { FileAssociations } from "@/components/settings/FileAssociations";
import { LanguageDropdown } from "@/components/LanguageSwitcher";
import { GlassCard } from "@/components/ui/GlassCard";
import { Segmented } from "@/components/ui/Segmented";
import { PillButton } from "@/components/ui/PillButton";
import { IconButton } from "@/components/ui/IconButton";
import { api, formatBytes, type RootRow } from "@/lib/api";
import { resetThumbs } from "@/lib/thumbs";
import { queryClient } from "@/lib/queryClient";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";
import { APP_VERSION } from "@/lib/version";
import appIcon from "../../assets/icon.svg";
import {
  readSetting,
  writeSetting,
  CURSOR_KEY,
} from "@/i18n";

/** Density presets in the order the segmented control shows them (FIX 4b). */
const DENSITY_ORDER: GridDensity[] = ["comfort", "medium", "compact"];

/**
 * P4 — mini glyph preview for the layout segmented: a 18×14 diagram of the
 * chrome. The previews are DIAGRAMS, not screenshots, so they stay legible at
 * 18px and cost nothing to render.
 */
function LayoutGlyph({ kind }: { kind: MainLayout }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden focusable="false">
      {kind === "classic" ? (
        <>
          <rect x="0" y="0" width="5" height="14" rx="1.5" className="fill-white/35" />
          <rect x="7" y="0" width="11" height="2.5" rx="1" className="fill-white/20" />
          <rect x="7" y="4.5" width="11" height="9.5" rx="1.5" className="fill-white/12" />
        </>
      ) : (
        <>
          <rect x="0" y="0" width="18" height="2.5" rx="1" className="fill-white/20" />
          <rect x="0" y="4.5" width="4" height="9.5" rx="1.5" className="fill-white/35" />
          <rect x="6.5" y="4.5" width="11.5" height="9.5" rx="1.5" className="fill-white/12" />
        </>
      )}
    </svg>
  );
}

/** Editorial numbered section header per DESIGN.md v2.2 §6. */
function Section({
  index,
  title,
  id,
  children,
}: {
  index: string;
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-6 flex items-center gap-4">
        <span className="text-3xl font-light text-accent">{index}</span>
        <h2 className="text-xl font-semibold text-tprimary">{title}</h2>
        <div className="divider mt-4 flex-1" />
      </div>
      {children}
    </section>
  );
}

export function SettingsContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [roots, setRoots] = useState<RootRow[]>([]);
  const [player, setPlayer] = useState("");
  const [bytes, setBytes] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<string>("libraries");
  const [cursorPointer, setCursorPointer] = useState(false);
  const scrubRate = useAppSettings((s) => s.videoScrubRate);
  const setScrubRate = useAppSettings((s) => s.setVideoScrubRate);
  const hoverCaptions = useAppSettings((s) => s.hoverCaptions);
  const setHoverCaptions = useAppSettings((s) => s.setHoverCaptions);
  const accent = useAppSettings((s) => s.accent);
  const setAccent = useAppSettings((s) => s.setAccent);
  const gridDensity = useAppSettings((s) => s.gridDensity);
  const setGridDensity = useAppSettings((s) => s.setGridDensity);
  const mainLayout = useAppSettings((s) => s.mainLayout);
  const setMainLayout = useAppSettings((s) => s.setMainLayout);
  const videoAutoplay = useAppSettings((s) => s.videoAutoplay);
  const setVideoAutoplay = useAppSettings((s) => s.setVideoAutoplay);
  const directPlayback = useAppSettings((s) => s.directPlayback);
  const setDirectPlayback = useAppSettings((s) => s.setDirectPlayback);
  const swipeNavigate = useAppSettings((s) => s.swipeNavigate);
  const setSwipeNavigate = useAppSettings((s) => s.setSwipeNavigate);
  const pillAlign = useAppSettings((s) => s.pillAlign);
  const setPillAlign = useAppSettings((s) => s.setPillAlign);
  const showFps = useAppSettings((s) => s.showFps);
  const showExcluded = useAppSettings((s) => s.showExcluded);
  const setShowExcluded = useAppSettings((s) => s.setShowExcluded);
  const thumbWorkers = useAppSettings((s) => s.thumbWorkers);
  const setThumbWorkers = useAppSettings((s) => s.setThumbWorkers);
  const setShowFps = useAppSettings((s) => s.setShowFps);

  useEffect(() => {
    void readSetting(CURSOR_KEY).then((v) =>
      setCursorPointer(v === "true"),
    );
  }, []);

  const toggleCursor = async (on: boolean) => {
    setCursorPointer(on);
    try {
      await writeSetting(CURSOR_KEY, String(on));
    } catch (e) {
      // B11: the class is applied optimistically, but a silently lost write
      // means the choice disappears next launch — say so.
      console.error("cursor setting save failed", e);
      toast.error(t("errors.action_failed"));
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const db = await getDb();
        const [libs, vals, size] = await Promise.all([
          api.listRoots(),
          db.select<{ value: string }[]>(
            "SELECT value FROM settings WHERE key = 'external_player'",
          ),
          invoke<number>("thumbnail_cache_size"),
        ]);
        if (!alive) return;
        setRoots(libs);
        setPlayer(vals[0]?.value ?? "");
        setBytes(size);
        setReady(true);
      } catch (e) {
        // B11: never swallow the reason — the inline message is not enough
        console.error("settings load failed", e);
        if (alive) {
          setMessage("settings.load_error");
          setFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await action();
      setMessage("settings.saved");
    } catch (e) {
      // B11: console + inline; the old bare `catch` lost the error entirely
      console.error("settings operation failed", e);
      setMessage("settings.operation_error");
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const refreshRoots = async () => {
    setRoots(await api.listRoots());
    await useRootsStore.getState().refresh();
  };

  const navItems = [
    { id: "libraries", icon: <FolderOpen size={18} />, label: t("settings.nav_libraries") },
    { id: "appearance", icon: <Palette size={18} />, label: t("settings.nav_appearance") },
    { id: "playback", icon: <Play size={18} />, label: t("settings.nav_playback") },
    { id: "cache", icon: <Gauge size={18} />, label: t("settings.nav_cache") },
    { id: "system", icon: <Cpu size={18} />, label: t("settings.nav_system") },
  ];
  /** stable list for the scrollspy observer (navItems is rebuilt per render) */
  const SECTION_IDS = navItems.map((n) => n.id);

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  // Scrollspy (FIX 2): keep the sticky nav in sync with the section actually
  // in view. The page scroller is the closest <main> ancestor (SettingsPage
  // owns `overflow-y-auto`), NOT the window — so it is the observer root.
  useEffect(() => {
    const first = document.getElementById(SECTION_IDS[0]);
    const root = (first?.closest("main") as HTMLElement | null) ?? null;
    const obs = new IntersectionObserver(
      (entries) => {
        // band intersects exactly one section in practice; take the last hit
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      // a thin band just under the top edge decides what "current" is
      { root, rootMargin: "-12% 0px -75% 0px", threshold: 0 },
    );
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="flex items-start gap-10">
      {/* sticky section nav — never scrolls out of view */}
      <nav className="sticky top-0 hidden w-[240px] shrink-0 flex-col gap-1 self-start md:flex">
        {navItems.map((n) => (
          <button
            key={n.id}
            onClick={() => jump(n.id)}
            className={
              "flex min-h-11 items-center gap-3 break-words rounded-control px-3 py-2 text-left text-sm leading-snug transition-all duration-[160ms] ease-out " +
              (active === n.id
                ? "bg-accent/[.14] text-tprimary [&_svg]:text-accent"
                : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary")
            }
          >
            <span className="shrink-0">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* content cards fill the full column width */}
      <div className="min-w-0 flex-1 space-y-12">
        {/* 01 Libraries */}
        <Section index="01" id="libraries" title={t("settings.nav_libraries")}>
          <GlassCard>
            <ExcludedFolders />
            {!roots.length && (
              <p className="mb-6 text-tsecondary">
                {t(ready ? "settings.no_libraries" : "settings.loading")}
              </p>
            )}
            <ul className="mb-6 space-y-4">
              {roots.map((root) => (
                <li
                  key={root.id}
                  className="flex items-center gap-3 rounded-control bg-surface-2 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {root.label || root.path}
                    </p>
                    <p className="break-all font-mono text-xs text-tsecondary">
                      {root.path}
                    </p>
                  </div>
                  <IconButton
                    label={t("sidebar.rescan", { label: root.label || root.path })}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.rescanRoot(root.id);
                        await refreshRoots();
                      })
                    }
                  >
                    <RefreshCw size={18} />
                  </IconButton>
                  <IconButton
                    label={t("actions.remove_root")}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.removeRoot(root.id);
                        await refreshRoots();
                      })
                    }
                  >
                    <Trash2 size={18} />
                  </IconButton>
                </li>
              ))}
            </ul>
            <PillButton variant="ghost" onClick={() => navigate("/onboarding")}>
              {t("sidebar.add_library")}
            </PillButton>
            <p className="mt-4 text-sm text-tsecondary">
              {t("settings.remove_hint")}
            </p>
          </GlassCard>
        </Section>

        {/* 02 Appearance */}
        <Section index="02" id="appearance" title={t("settings.nav_appearance")}>
          <GlassCard>
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
              <div className="flex items-center gap-3 text-sm text-tprimary">
                <Languages size={18} className="text-tsecondary" />
                {t("settings.language")}
              </div>
              <div className="w-44">
                <LanguageDropdown />
              </div>
            </div>
            <div className="mt-2 flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">{t("settings.theme")}</span>
              <span className="text-sm text-tsecondary">{t("settings.dark")}</span>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">
                {t("settings.cursor_pointer")}
              </span>
              <button
                role="switch"
                aria-checked={cursorPointer}
                aria-label={t("settings.cursor_pointer")}
                onClick={() => void toggleCursor(!cursorPointer)}
                className={
                  "relative h-6 w-11 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (cursorPointer ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (cursorPointer ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.show_fps")}</span>
                <span className="text-[12px] text-ttertiary">{t("settings.show_fps_hint")}</span>
              </span>
              <button
                role="switch"
                aria-checked={showFps}
                aria-label={t("settings.show_fps")}
                onClick={() => void setShowFps(!showFps)}
                className={
                  "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (showFps ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (showFps ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.pill_align")}</span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.pill_align_hint")}
                </span>
              </span>
              <div
                role="radiogroup"
                aria-label={t("settings.pill_align")}
                className="flex shrink-0 items-center gap-1 rounded-pill bg-surface-3 p-1"
              >
                {(
                  [
                    ["left", "settings.pill_left"],
                    ["center", "settings.pill_center"],
                    ["right", "settings.pill_right"],
                  ] as const
                ).map(([value, key]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={pillAlign === value}
                    aria-label={t(key)}
                    title={t(key)}
                    onClick={() => void setPillAlign(value)}
                    className={
                      "flex h-7 items-center rounded-pill px-3 text-[12px] transition-colors duration-[160ms] " +
                      (pillAlign === value
                        ? "bg-white/[.14] text-tprimary"
                        : "text-tsecondary hover:text-tprimary")
                    }
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.swipe_navigate")}</span>
                <span className="text-[12px] text-ttertiary">{t("settings.swipe_hint")}</span>
              </span>
              <button
                role="switch"
                aria-checked={swipeNavigate}
                aria-label={t("settings.swipe_navigate")}
                onClick={() => void setSwipeNavigate(!swipeNavigate)}
                className={
                  "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (swipeNavigate ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (swipeNavigate ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">
                {t("settings.hover_captions")}
              </span>
              <button
                role="switch"
                aria-checked={hoverCaptions}
                aria-label={t("settings.hover_captions")}
                onClick={() => void setHoverCaptions(!hoverCaptions)}
                className={
                  "relative h-6 w-11 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (hoverCaptions ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (hoverCaptions ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">
                {t("settings.video_autoplay")}
              </span>
              <button
                role="switch"
                aria-checked={videoAutoplay}
                aria-label={t("settings.video_autoplay")}
                onClick={() => void setVideoAutoplay(!videoAutoplay)}
                className={
                  "relative h-6 w-11 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (videoAutoplay ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (videoAutoplay ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.thumb_workers")}</span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.thumb_workers_hint")}
                </span>
              </span>
              <div
                role="radiogroup"
                aria-label={t("settings.thumb_workers")}
                className="flex shrink-0 items-center gap-1 rounded-pill bg-surface-3 p-1"
              >
                {THUMB_WORKER_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={thumbWorkers === n}
                    aria-label={String(n)}
                    onClick={() => void setThumbWorkers(n)}
                    className={
                      "flex h-7 w-9 items-center justify-center rounded-pill font-mono text-[12px] tabular-nums transition-colors duration-[160ms] " +
                      (thumbWorkers === n
                        ? "bg-white/[.14] text-tprimary"
                        : "text-tsecondary hover:text-tprimary")
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.show_excluded")}</span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.show_excluded_hint")}
                </span>
              </span>
              <button
                role="switch"
                aria-checked={showExcluded}
                aria-label={t("settings.show_excluded")}
                onClick={() => void setShowExcluded(!showExcluded)}
                className={
                  "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (showExcluded ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (showExcluded ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            {/* FIX 4a: accent presets — the swatch rewrites the CSS vars live,
                every accent anchor in the app follows it */}
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">
                  {t("settings.accent_color")}
                </span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.accent_hint")}
                </span>
              </span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {ACCENTS.map((preset) => {
                  const active =
                    accent.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={t(preset.labelKey)}
                      aria-label={t(preset.labelKey)}
                      aria-pressed={active}
                      onClick={() => void setAccent(preset.hex)}
                      className={cn(
                        "h-8 w-8 rounded-pill transition-all duration-[160ms] ease-out active:scale-[.94]",
                        active
                          ? "ring-2 ring-white/85 ring-offset-2 ring-offset-surface-1"
                          : "opacity-80 hover:scale-105 hover:opacity-100",
                      )}
                      style={{ background: preset.hex }}
                    />
                  );
                })}
                {/* custom swatch (Material You): any hex flows through the same
                    CSS vars — the active ring marks a NON-preset colour */}
                <label
                  title={t("settings.accent_custom")}
                  aria-label={t("settings.accent_custom")}
                  className={cn(
                    "relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-pill transition-all duration-[160ms] ease-out hover:scale-105 active:scale-[.94]",
                    isPresetAccent(accent)
                      ? "opacity-90 hover:opacity-100"
                      : "ring-2 ring-white/85 ring-offset-2 ring-offset-surface-1",
                  )}
                  style={{
                    background: isPresetAccent(accent)
                      ? "conic-gradient(from 200deg, #8A7CFF, #F45BD8, #FF7A59, #AEE64B, #45E3E0, #6EC1FF, #8A7CFF)"
                      : accent,
                  }}
                >
                  {!isPresetAccent(accent) && <Check size={13} strokeWidth={3} className="text-[#0A0A0C]" />}
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT}
                    onChange={(e) => void setAccent(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            {/* FIX 4b: grid density — target row height, gutter and masonry
                column width, applied to the grid live (no reload) */}
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">
                  {t("settings.grid_density")}
                </span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.grid_density_hint", {
                    h: DENSITY_PARAMS[gridDensity].targetH,
                    gap: DENSITY_PARAMS[gridDensity].gap,
                  })}
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                {DENSITY_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={gridDensity === d}
                    aria-label={t(`settings.density_${d}`)}
                    onClick={() => void setGridDensity(d)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-pill px-3.5",
                      "font-mono text-[12px] transition-colors duration-[160ms] ease-out active:scale-[.97]",
                      gridDensity === d
                        ? "bg-accent text-[#0A0A0C]"
                        : "bg-surface-2 text-tsecondary hover:text-tprimary",
                    )}
                  >
                    {t(`settings.density_${d}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* P4: main-screen layout — classic sidebar vs permanent icon rail.
                MAIN SCREEN ONLY: viewers/player/collage are untouched. */}
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.main_layout")}</span>
                <span className="text-[12px] text-ttertiary">
                  {t("settings.main_layout_hint")}
                </span>
              </span>
              <Segmented<MainLayout>
                aria-label={t("settings.main_layout")}
                value={mainLayout}
                onChange={(v) => void setMainLayout(v)}
                options={[
                  {
                    value: "classic",
                    label: t("settings.main_layout_classic"),
                    icon: <LayoutGlyph kind="classic" />,
                  },
                  {
                    value: "rail",
                    label: t("settings.main_layout_rail"),
                    icon: <LayoutGlyph kind="rail" />,
                  },
                ]}
              />
            </div>
          </GlassCard>
        </Section>

        {/* 03 Playback */}
        <Section index="03" id="playback" title={t("settings.nav_playback")}>
          <GlassCard>
            <div className="flex items-center justify-between border-b border-hairline pb-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-tprimary">{t("settings.direct_playback")}</span>
                <span className="text-[12px] text-ttertiary">{t("settings.direct_playback_hint")}</span>
              </span>
              <button
                role="switch"
                aria-checked={directPlayback}
                aria-label={t("settings.direct_playback")}
                onClick={() => void setDirectPlayback(!directPlayback)}
                className={
                  "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out " +
                  (directPlayback ? "bg-accent" : "bg-surface-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-[160ms] ease-out " +
                    (directPlayback ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
              <span className="text-sm text-tprimary">{t("settings.scrub_speed")}</span>
              <div className="flex items-center gap-1.5">
                {SCRUB_RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    aria-pressed={scrubRate === rate}
                    aria-label={t("settings.scrub_rate", { rate })}
                    onClick={() => void setScrubRate(rate)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-pill px-3.5 font-mono text-[12px] transition-colors duration-[160ms] ease-out active:scale-[.97]",
                      scrubRate === rate
                        ? "bg-accent text-[#0A0A0C]"
                        : "bg-surface-2 text-tsecondary hover:text-tprimary",
                    )}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm text-tsecondary">{t("settings.scrub_hint")}</p>
          </GlassCard>
        </Section>

        {/* 04 Cache & Performance */}
        <Section index="04" id="cache" title={t("settings.nav_cache")}>
          <GlassCard>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-sm text-tprimary">{t("settings.cache")}</span>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[12px] text-tsecondary">
                  {bytes === null ? t("settings.loading") : formatBytes(bytes)}
                </span>
                <PillButton
                  variant="ghost"
                  disabled={!ready || busy}
                  onClick={() =>
                    void perform(async () => {
                      await invoke("clear_thumbnail_cache");
                      // rows + in-memory state must come back empty, otherwise a
                      // stale (e.g. black) video frame stays on screen forever
                      resetThumbs();
                      await queryClient.invalidateQueries({ queryKey: ["media"] });
                      setBytes(await invoke<number>("thumbnail_cache_size"));
                    })
                  }
                >
                  <Trash2 size={16} />
                  {t("settings.clear_cache")}
                </PillButton>
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* 05 System */}
        <Section index="05" id="system" title={t("settings.nav_system")}>
          <GlassCard>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  // single-writer path (S1.12): settings writes no longer open a
                  // private pool connection next to the thumbnail batches
                  await writeSetting("external_player", player.trim());
                });
              }}
            >
              <label
                htmlFor="external-player"
                className="mb-4 block text-sm text-tprimary"
              >
                {t("settings.external_player")}
              </label>
              <input
                id="external-player"
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                disabled={!ready || busy}
                placeholder={t("settings.player_placeholder")}
                className="h-11 w-full rounded-control bg-surface-2 px-4 font-mono text-[13px] text-tprimary placeholder:text-ttertiary focus:outline-none"
              />
              <div className="mt-4 flex items-center gap-3">
                <PillButton type="submit" disabled={!ready || busy}>
                  {t("settings.save")}
                </PillButton>
                <PillButton
                  type="button"
                  variant="ghost"
                  disabled={!ready || !player.trim()}
                  onClick={() => {
                    void invoke<boolean>("check_player", { path: player.trim() })
                      .then((ok) =>
                        ok
                          ? toast.success(t("settings.check_ok"))
                          : toast.error(t("settings.check_missing")),
                      )
                      .catch((e) => toast.error(String(e)));
                  }}
                >
                  {t("settings.check")}
                </PillButton>
              </div>
            </form>
            {/* Phase 6 STEP 4: opt-in, reversible, HKCU-only associations */}
            <FileAssociations />
            <div className="mt-2 flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">{t("settings.open_logs")}</span>
              <button
                type="button"
                onClick={() =>
                  void appLogDir()
                    .then((d) => invoke("reveal_path", { path: d }))
                    .catch((e) => toast.error(String(e)))
                }
                className="rounded-pill px-3 py-1.5 font-mono text-[12px] text-tsecondary transition-colors hover:bg-white/[.06] hover:text-tprimary"
              >
                {t("settings.reveal")}
              </button>
            </div>
            <div className="flex min-h-16 items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">{t("settings.open_thumbs")}</span>
              <button
                type="button"
                onClick={() =>
                  void appCacheDir()
                    .then((d) => join(d, "thumbs"))
                    .then((p) => invoke("reveal_path", { path: p }))
                    .catch((e) => toast.error(String(e)))
                }
                className="rounded-pill px-3 py-1.5 font-mono text-[12px] text-tsecondary transition-colors hover:bg-white/[.06] hover:text-tprimary"
              >
                {t("settings.reveal")}
              </button>
            </div>
          </GlassCard>
        </Section>

        {/* 06 About (P3 — material about screen) */}
        <Section index="06" id="about" title={t("settings.nav_about")}>
          <GlassCard>
            {/* identity: the app mark, the name in display type, a mono build
                chip. Nothing else competes with it — the facts live below. */}
            <div className="flex flex-col items-center pt-2 pb-7 text-center">
              <img
                src={appIcon}
                alt=""
                aria-hidden
                width={96}
                height={96}
                draggable={false}
                className="h-24 w-24 select-none rounded-[26px] shadow-[0_8px_24px_rgba(0,0,0,.35)]"
              />
              <h3 className="mt-5 text-[32px] leading-[1.05] font-[650] tracking-[-0.02em] text-tprimary">
                LUMEN
              </h3>
              <span className="mt-3 rounded-pill bg-white/[.06] px-3 py-1 font-mono text-[11px] tabular-nums text-tsecondary">
                {__BUILD_ID__ === "dev"
                  ? `v${APP_VERSION} · ${t("settings.about_dev_build")}`
                  : `v${APP_VERSION} · ${__BUILD_ID__}`}
              </span>
            </div>

            {/* the facts: one list, hairline dividers (editorial only) */}
            <div className="border-t border-hairline">
              <AboutRow label={t("settings.about_author")}>Stanislav Miroshnichenko</AboutRow>
              <AboutRow label={t("settings.about_github")}>
                <button
                  type="button"
                  onClick={() =>
                    void invoke("open_url", { url: "https://github.com/Stamir36" }).catch(
                      (e) => toast.error(String(e)),
                    )
                  }
                  // the app-wide :focus-visible ring (index.css) already applies;
                  // a second white ring here was off-token
                  className="rounded-pill px-1 font-mono text-[13px] text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
                >
                  github.com/Stamir36
                </button>
              </AboutRow>
              <AboutRow label={t("settings.about_studio")}>Unesell Studio</AboutRow>
              <AboutRow label={t("settings.about_package")}>
                <span className="font-mono text-[12px]">com.unesell.lumen</span>
              </AboutRow>
              <AboutRow label={t("settings.about_license")}>
                {t("settings.about_license_value")}
              </AboutRow>
              <AboutRow label={t("settings.about_stack")}>
                <span className="font-mono text-[12px]">Tauri v2 · React · Rust · SQLite</span>
              </AboutRow>
            </div>
          </GlassCard>
        </Section>

        {message && (
          <p
            role={failed ? "alert" : "status"}
            className={failed ? "text-sm text-danger" : "text-sm text-tsecondary"}
          >
            {t(message)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One fact row of the About list (P3): label left, value right, separated by an
 * editorial hairline — the only border DESIGN v2.4 allows.
 */
function AboutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-hairline py-4 last:border-b-0">
      <span className="shrink-0 text-sm text-tprimary">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-tsecondary">{children}</span>
    </div>
  );
}
