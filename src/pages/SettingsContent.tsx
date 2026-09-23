import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, appLogDir, join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Wand2,
  FolderOpen,
  Palette,
  RefreshCw,
  Trash2,
  Gauge,
  Cpu,
  Play,
  MousePointerClick,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DENSITY_PARAMS,
  RADIUS_PRESETS,
  SCRUB_RATES,
  THUMB_WORKER_OPTIONS,
  useAppSettings,
  type GridDensity,
  type MainLayout,
  type PillAlign,
  type UiRadius,
} from "@/lib/settings";
import { ACCENTS } from "@/lib/accent";
import { ExcludedFolders } from "@/components/settings/ExcludedFolders";
import { FileAssociations } from "@/components/settings/FileAssociations";
import { LanguageDropdown } from "@/components/LanguageSwitcher";
import { GlassCard } from "@/components/ui/GlassCard";
import { AccentPicker } from "@/components/ui/AccentPicker";
import { PillButton } from "@/components/ui/PillButton";
import { IconButton } from "@/components/ui/IconButton";
import { PillChoice, SettingRow, Toggle } from "@/components/settings/Primitives";
import { LayoutDiagram } from "@/components/settings/LayoutDiagram";
import { DiagramCard } from "@/components/settings/DiagramCard";
import { api, formatBytes, type RootRow } from "@/lib/api";
import { resetThumbs } from "@/lib/thumbs";
import { queryClient } from "@/lib/queryClient";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";
import { APP_VERSION } from "@/lib/version";
import appIcon from "../../assets/icon.svg";
import { readSetting, writeSetting, CURSOR_KEY, setCustomCursor, CUSTOM_CURSOR_KEY } from "@/i18n";

/** Density presets in the order the segmented control shows them (FIX 4b). */
const DENSITY_ORDER: GridDensity[] = ["comfort", "medium", "compact"];

/** Layout choice card in Settings = the wizard's OptionCard + shared diagram. */
function LayoutCard({
  kind,
  active,
  label,
  onClick,
}: {
  kind: MainLayout;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <DiagramCard
      active={active}
      onClick={onClick}
      label={label}
      diagram={<LayoutDiagram kind={kind} active={active} />}
    />
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
    // F11: each section rises in as it scrolls into view — the page used to be
    // one static slab. `whileInView` + once, so scrolling back up is quiet.
    <motion.section
      id={id}
      className="scroll-mt-6"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.06 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="mb-6 flex items-center gap-4">
        <span className="text-3xl font-extralight tracking-tight text-accent">{index}</span>
        <h2 className="text-xl font-semibold text-tprimary">{title}</h2>
        <div className="divider mt-4 flex-1" />
      </div>
      {children}
    </motion.section>
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
  const [customCursor, setCustomCursorState] = useState(false);
  // BUGS 29.09: text-selection is a developer tool — hidden until the user
  // clicks the About logo 5× (the classic Android “debug mode” gesture).
  // Persisted: once unlocked it stays unlocked. The gesture: 5 clicks on the
  // About logo (same spirit as the Android debug easter egg).
  const [devUnlocked, setDevUnlocked] = useState(false);
  const logoClicks = useRef(0);
  const onLogoClick = () => {
    if (devUnlocked) return;
    logoClicks.current += 1;
    if (logoClicks.current >= 5) {
      setDevUnlocked(true);
      void writeSetting("ui.dev_unlocked", "true").catch(() => undefined);
    }
  };

  const scrubRate = useAppSettings((s) => s.videoScrubRate);
  const setScrubRate = useAppSettings((s) => s.setVideoScrubRate);
  const hoverCaptions = useAppSettings((s) => s.hoverCaptions);
  const setHoverCaptions = useAppSettings((s) => s.setHoverCaptions);
  const cardHover = useAppSettings((s) => s.cardHover);
  const setCardHover = useAppSettings((s) => s.setCardHover);
  const textSelection = useAppSettings((s) => s.textSelection);
  const setTextSelection = useAppSettings((s) => s.setTextSelection);
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
  const uiMotion = useAppSettings((s) => s.uiMotion);
  const setUiMotion = useAppSettings((s) => s.setUiMotion);
  const uiRadius = useAppSettings((s) => s.uiRadius);
  const setUiRadius = useAppSettings((s) => s.setUiRadius);
  const backgroundMode = useAppSettings((s) => s.backgroundMode);
  const setBackgroundMode = useAppSettings((s) => s.setBackgroundMode);

  useEffect(() => {
    void readSetting(CURSOR_KEY).then((v) => setCursorPointer(v === "true"));
    void readSetting(CUSTOM_CURSOR_KEY).then((v) => setCustomCursor(v === "true"));
    void readSetting("ui.dev_unlocked").then((v) => setDevUnlocked(v === "true"));
  }, []);

  const toggleCustomCursor = async (on: boolean) => {
    setCustomCursorState(on); // optimistic — same pattern as toggleCursor
    try {
      await setCustomCursor(on); // applies the attribute AND persists
      setCustomCursorState(on);
    } catch (e) {
      console.error("custom cursor save failed", e);
      toast.error(t("errors.action_failed"));
    }
  };

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
    { id: "behavior", icon: <MousePointerClick size={18} />, label: t("settings.nav_behavior") },
    { id: "playback", icon: <Play size={18} />, label: t("settings.nav_playback") },
    { id: "cache", icon: <Gauge size={18} />, label: t("settings.nav_cache") },
    { id: "system", icon: <Cpu size={18} />, label: t("settings.nav_system") },
    // BUGS 29.09: About existed only as a section — the left nav never listed it
    { id: "about", icon: <Info size={18} />, label: t("settings.nav_about") },
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
            className={cn(
              "relative flex min-h-11 items-center gap-3 break-words rounded-control px-3 py-2",
              "text-left text-sm leading-snug transition-colors duration-[160ms] ease-out",
              active === n.id
                ? "text-tprimary [&_svg]:text-accent"
                : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
            )}
          >
            {/* the tinted pill SLIDES between rows (framer layoutId) instead of
                blinking — the nav reads as one control, not six */}
            {active === n.id && (
              <motion.span
                layoutId="settings-nav-pill"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-control bg-accent/[.14] shadow-[inset_0_1px_0_var(--accent-soft)]"
              />
            )}
            <span className="relative z-10 shrink-0">{n.icon}</span>
            <span className="relative z-10">{n.label}</span>
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
                    <p className="truncate font-medium">{root.label || root.path}</p>
                    <p className="break-all font-mono text-xs text-tsecondary">{root.path}</p>
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
            <p className="mt-4 text-sm text-tsecondary">{t("settings.remove_hint")}</p>
          </GlassCard>
        </Section>

        {/* 02 Appearance */}
        <Section index="02" id="appearance" title={t("settings.nav_appearance")}>
          <GlassCard>
            <SettingRow label={t("settings.language")}>
              <div className="w-44">
                <LanguageDropdown />
              </div>
            </SettingRow>

            <SettingRow label={t("settings.theme")}>
              <span className="text-sm text-tsecondary">{t("settings.dark")}</span>
            </SettingRow>

            {/* accent presets — the swatch rewrites the CSS vars live, every
                accent anchor in the app follows it */}
            <SettingRow label={t("settings.accent_color")} hint={t("settings.accent_hint")}>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {ACCENTS.map((preset) => {
                  const activeAccent = accent.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={t(preset.labelKey)}
                      aria-label={t(preset.labelKey)}
                      aria-pressed={activeAccent}
                      onClick={() => void setAccent(preset.hex)}
                      className={cn(
                        "h-8 w-8 rounded-pill transition-all duration-[160ms] ease-out active:scale-[.94]",
                        activeAccent
                          ? "ring-2 ring-white/85 ring-offset-2 ring-offset-surface-1"
                          : "opacity-80 hover:scale-105 hover:opacity-100",
                      )}
                      style={{ background: preset.hex }}
                    />
                  );
                })}
                {/* F12: the in-app HSV picker (hue strip + saturation field +
                    hex field). The OS colour dialog was the one piece of chrome
                    that screamed "web page" */}
                <AccentPicker accent={accent} onPick={(hex) => void setAccent(hex)} />
              </div>
            </SettingRow>

            {/* grid density — target row height, gutter and masonry column
                width, applied to the grid live (no reload) */}
            <SettingRow
              label={t("settings.grid_density")}
              hint={t("settings.grid_density_hint", {
                h: DENSITY_PARAMS[gridDensity].targetH,
                gap: DENSITY_PARAMS[gridDensity].gap,
              })}
            >
              <PillChoice<GridDensity>
                ariaLabel={t("settings.grid_density")}
                value={gridDensity}
                onChange={(d) => void setGridDensity(d)}
                className="bg-surface-2 p-1"
                options={DENSITY_ORDER.map((d) => ({
                  value: d,
                  label: t(`settings.density_${d}`),
                }))}
              />
            </SettingRow>

            {/* P4: main-screen layout — classic sidebar vs permanent icon rail.
                MAIN SCREEN ONLY: viewers/player/collage are untouched.
                BUGS 29.09 #4: this was the one row with a unique toggle design;
                now it uses the wizard's diagram cards (LayoutDiagram lives in
                SetupWizard and is reused here verbatim). */}
            <div className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
              <p className="text-sm text-tprimary">{t("settings.main_layout")}</p>
              <p className="mb-3 mt-0.5 text-[12px] leading-snug text-ttertiary">
                {t("settings.main_layout_hint")}
              </p>
              <div className="flex gap-3">
                <LayoutCard
                  kind="classic"
                  active={mainLayout === "classic"}
                  label={t("settings.main_layout_classic")}
                  onClick={() => void setMainLayout("classic")}
                />
                <LayoutCard
                  kind="rail"
                  active={mainLayout === "rail"}
                  label={t("settings.main_layout_rail")}
                  onClick={() => void setMainLayout("rail")}
                />
              </div>
            </div>

            {/* corner language: one attribute, every card/control follows */}
            <SettingRow label={t("settings.corners")} hint={t("settings.corners_hint")}>
              <PillChoice<UiRadius>
                ariaLabel={t("settings.corners")}
                value={uiRadius}
                onChange={(v) => void setUiRadius(v)}
                options={RADIUS_PRESETS.map((r) => ({ value: r.id, label: t(r.labelKey) }))}
              />
            </SettingRow>

            <Toggle
              label={t("settings.card_hover")}
              hint={t("settings.card_hover_hint")}
              on={cardHover}
              onChange={(v) => void setCardHover(v)}
            />
            <Toggle
              label={t("settings.ui_motion")}
              hint={t("settings.ui_motion_hint")}
              on={uiMotion}
              onChange={(v) => void setUiMotion(v)}
            />
            <Toggle
              label={t("settings.cursor_pointer")}
              on={cursorPointer}
              onChange={(v) => void toggleCursor(v)}
            />
            {/* the drawn LUMEN cursor — a taste, default OFF (see index.css) */}
            <Toggle
              label={t("settings.custom_cursor")}
              hint={t("settings.custom_cursor_hint")}
              on={customCursor}
              onChange={(v) => void toggleCustomCursor(v)}
            />
            {/* BUGS 29.09: developer-only switch — hidden until the About logo
                easter egg (5 clicks) unlocks it for the session. */}
            {devUnlocked && (
              <Toggle
                label={t("settings.text_selection")}
                hint={t("settings.text_selection_hint")}
                on={textSelection}
                onChange={(v) => void setTextSelection(v)}
              />
            )}
            <Toggle
              label={t("settings.show_fps")}
              hint={t("settings.show_fps_hint")}
              on={showFps}
              onChange={(v) => void setShowFps(v)}
            />
            <SettingRow label={t("settings.pill_align")} hint={t("settings.pill_align_hint")}>
              <PillChoice<PillAlign>
                ariaLabel={t("settings.pill_align")}
                value={pillAlign}
                onChange={(v) => void setPillAlign(v)}
                options={[
                  { value: "left", label: t("settings.pill_left") },
                  { value: "center", label: t("settings.pill_center") },
                  { value: "right", label: t("settings.pill_right") },
                ]}
              />
            </SettingRow>

            {/* Setup wizard entry point: the first-run personalization walkthrough,
                always reachable — a user must not have to remember it existed */}
            <SettingRow label={t("setup.settings_entry")} hint={t("setup.settings_entry_hint")}>
              <PillButton variant="ghost" onClick={() => navigate("/setup")}>
                <Wand2 size={16} /> {t("setup.open")}
              </PillButton>
            </SettingRow>
          </GlassCard>
        </Section>

        {/* 03 Behavior */}
        <Section index="03" id="behavior" title={t("settings.nav_behavior")}>
          <GlassCard>
            <Toggle
              label={t("settings.video_autoplay")}
              hint={t("settings.video_autoplay_hint")}
              on={videoAutoplay}
              onChange={(v) => void setVideoAutoplay(v)}
            />
            <Toggle
              label={t("settings.swipe_navigate")}
              hint={t("settings.swipe_hint")}
              on={swipeNavigate}
              onChange={(v) => void setSwipeNavigate(v)}
            />
            <Toggle
              label={t("settings.hover_captions")}
              hint={t("settings.hover_captions_hint")}
              on={hoverCaptions}
              onChange={(v) => void setHoverCaptions(v)}
            />
            {/* the one switch that changes how the APP quits: default OFF */}
            <Toggle
              label={t("settings.background_mode")}
              hint={t("settings.background_mode_hint")}
              on={backgroundMode}
              onChange={(v) => void setBackgroundMode(v)}
            />
            <Toggle
              label={t("settings.show_excluded")}
              hint={t("settings.show_excluded_hint")}
              on={showExcluded}
              onChange={(v) => void setShowExcluded(v)}
            />
            <SettingRow label={t("settings.thumb_workers")} hint={t("settings.thumb_workers_hint")}>
              <PillChoice<number>
                ariaLabel={t("settings.thumb_workers")}
                value={thumbWorkers}
                onChange={(n) => void setThumbWorkers(n)}
                options={THUMB_WORKER_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
              />
            </SettingRow>
          </GlassCard>
        </Section>

        {/* 04 Playback */}
        <Section index="04" id="playback" title={t("settings.nav_playback")}>
          <GlassCard>
            <Toggle
              label={t("settings.direct_playback")}
              hint={t("settings.direct_playback_hint")}
              on={directPlayback}
              onChange={(v) => void setDirectPlayback(v)}
            />
            <SettingRow label={t("settings.scrub_speed")} hint={t("settings.scrub_hint")}>
              <PillChoice<number>
                ariaLabel={t("settings.scrub_speed")}
                value={scrubRate}
                onChange={(r) => void setScrubRate(r)}
                className="bg-surface-2 p-1"
                options={SCRUB_RATES.map((r) => ({ value: r, label: `${r}×` }))}
              />
            </SettingRow>
          </GlassCard>
        </Section>

        {/* 05 Cache & Performance */}
        <Section index="05" id="cache" title={t("settings.nav_cache")}>
          <GlassCard>
            <SettingRow label={t("settings.cache")}>
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
            </SettingRow>
          </GlassCard>
        </Section>

        {/* 06 System */}
        <Section index="06" id="system" title={t("settings.nav_system")}>
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
              <label htmlFor="external-player" className="mb-4 block text-sm text-tprimary">
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
            <SettingRow label={t("settings.open_logs")}>
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
            </SettingRow>
            <SettingRow label={t("settings.open_thumbs")}>
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
            </SettingRow>
          </GlassCard>
        </Section>

        {/* 07 About (P3 — material about screen) */}
        <Section index="07" id="about" title={t("settings.nav_about")}>
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
                onClick={onLogoClick}
                className="h-24 w-24 cursor-default select-none rounded-[26px] shadow-[0_8px_24px_rgba(0,0,0,.35)]"
              />
              {devUnlocked && (
                <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                  {t("settings.dev_mode_on")}
                </span>
              )}
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
              {/* the source: the project lives here, releases and issues too */}
              <AboutRow label={t("settings.about_github")}>
                <RepoLink url="https://github.com/Stamir36/lumen-gallery">
                  github.com/Stamir36/lumen-gallery
                </RepoLink>
              </AboutRow>
              {/* the shortest path from "this is broken" to a bug report */}
              <AboutRow label={t("settings.about_issues")}>
                <RepoLink url="https://github.com/Stamir36/lumen-gallery/issues/new/choose">
                  {t("settings.about_issues_cta")}
                </RepoLink>
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
 * An external link in the About list. The app-wide :focus-visible ring
 * (index.css) already applies — a second white ring here was off-token.
 */
function RepoLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void invoke("open_url", { url }).catch((e) => toast.error(String(e)))}
      className="rounded-pill px-1 font-mono text-[13px] text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
    >
      {children}
    </button>
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
