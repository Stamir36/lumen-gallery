import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Film,
  Images,
  Languages,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Heart,
  MousePointerClick,
  Layers,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LOCALES, persistLang, type Lang } from "@/i18n";
import { ACCENTS } from "@/lib/accent";
import { writeSetting } from "@/i18n";
import {
  useAppSettings,
  DENSITY_PARAMS,
  RADIUS_PRESETS,
  type MainLayout,
  type GridDensity,
  type UiRadius,
} from "@/lib/settings";
import { PillChoice, Toggle } from "@/components/settings/Primitives";
import { LayoutDiagram } from "@/components/settings/LayoutDiagram";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tauriAvailable } from "@/lib/assets";

/**
 * SETUP WIZARD — first-run personalization.
 *
 * Four steps, then a real finish panel:
 *
 *   1. Language    — applies live (the wizard's own chrome is the proof);
 *   2. Accent      — the whole app repaints under the pointer;
 *   3. Interface   — layout, density, corners, card + micro animations;
 *   4. Behavior    — autoplay, swipe, hover captions, background (tray) mode.
 *   ✓  Finish      — a summary of what was chosen + the way into the library.
 *
 * Design contract: every pick applies IMMEDIATELY (there is no "apply at the
 * end" step), so the wizard is a preview, not a form. The finish panel exists
 * because the wizard used to run off the end of its own step list — pressing
 * "Next" on the last step advanced past it and rendered empty cards forever.
 * `next()` can no longer exceed `lastStep`.
 *
 * Works without Tauri (#/setup is the QA route); the tray switch is simply
 * inert in a plain browser.
 */

const LAST_STEP = 3;
const FINISH_STEP = 4;

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  const current: Lang = i18n.language.startsWith("ru") ? "ru" : "en";

  const accent = useAppSettings((s) => s.accent);
  const setAccent = useAppSettings((s) => s.setAccent);
  const mainLayout = useAppSettings((s) => s.mainLayout);
  const setMainLayout = useAppSettings((s) => s.setMainLayout);
  const cardHover = useAppSettings((s) => s.cardHover);
  const setCardHover = useAppSettings((s) => s.setCardHover);
  const gridDensity = useAppSettings((s) => s.gridDensity);
  const setGridDensity = useAppSettings((s) => s.setGridDensity);
  const uiRadius = useAppSettings((s) => s.uiRadius);
  const setUiRadius = useAppSettings((s) => s.setUiRadius);
  const uiMotion = useAppSettings((s) => s.uiMotion);
  const setUiMotion = useAppSettings((s) => s.setUiMotion);
  const videoAutoplay = useAppSettings((s) => s.videoAutoplay);
  const setVideoAutoplay = useAppSettings((s) => s.setVideoAutoplay);
  const swipeNavigate = useAppSettings((s) => s.swipeNavigate);
  const setSwipeNavigate = useAppSettings((s) => s.setSwipeNavigate);
  const hoverCaptions = useAppSettings((s) => s.hoverCaptions);
  const setHoverCaptions = useAppSettings((s) => s.setHoverCaptions);
  const backgroundMode = useAppSettings((s) => s.backgroundMode);
  const setBackgroundMode = useAppSettings((s) => s.setBackgroundMode);

  const changeLang = async (lng: Lang) => {
    if (lng === current) return;
    await i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
    try {
      await persistLang(lng);
    } catch {
      /* browser QA — persistence is best-effort */
    }
  };

  const steps = useMemo(
    () => [
      t("setup.step_language"),
      t("setup.step_accent"),
      t("setup.step_interface"),
      t("setup.step_behavior"),
    ],
    [t],
  );

  /** Bounded navigation: the last step finishes instead of advancing. */
  const go = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(LAST_STEP, target));
      setDir(clamped >= step ? 1 : -1);
      setStep(clamped);
    },
    [step],
  );

  const next = useCallback(async () => {
    if (step < LAST_STEP) {
      setDir(1);
      setStep(step + 1);
      return;
    }
    // finish: remember that the wizard has been seen (first-run gate in App)
    setDir(1);
    try {
      await writeSetting("setup_completed", "true");
    } catch {
      /* browser QA — no backend */
    }
    setStep(FINISH_STEP);
  }, [step]);

  const back = useCallback(() => {
    if (step === FINISH_STEP) {
      setDir(-1);
      setStep(LAST_STEP);
      return;
    }
    go(step - 1);
  }, [go, step]);

  const atFinish = step === FINISH_STEP;

  /** BUGS 23.09: the wizard take-over kept the titlebar, but its drag spacer
   *  is narrow — grab any empty spot of the wizard's own top band instead.
   *  Buttons/labels stop propagation so controls never drag the window.
   *  Guarded: getCurrentWindow() throws in a plain browser (QA routes). */
  const dragWindow = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    if (!tauriAvailable()) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div className="relative h-full overflow-y-auto px-10 pt-16 pb-10">
      {/* full-width drag band above the content (56px): grab the window here
          when the titlebar's own spacer is out of reach */}
      <div
        aria-hidden
        onMouseDown={dragWindow}
        className="absolute inset-x-0 top-0 h-14 cursor-default"
      />
      {/* the accent announces itself behind the content — pure CSS vars, so
          every pick in step 2 repaints this glow live */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background: "radial-gradient(60% 70% at 24% 0%, var(--accent-soft), transparent 70%)",
          opacity: 0.75,
        }}
      />

      <div className="relative mx-auto flex max-w-6xl items-start gap-10">
        {/* ---------------- main column ---------------- */}
        <div className="min-w-0 flex-1">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-accent/[.14]">
                <Sparkles size={20} className="text-accent" />
              </span>
              <h1 className="text-3xl font-bold tracking-tight text-tprimary">
                {t("setup.title")}
              </h1>
            </div>
            <p className="mt-3 max-w-xl text-[15px] text-tsecondary">{t("setup.subtitle")}</p>
          </motion.div>

          {/* progress rail: one bar per step, clickable, the done ones carry a
              check. Hidden on the finish panel — there is nothing left to do. */}
          {!atFinish && (
            <div
              className="mt-8 flex items-end gap-2"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={step + 1}
            >
              {steps.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={label}
                  aria-current={i === step ? "step" : undefined}
                  className="group flex flex-1 flex-col gap-1.5 text-left"
                >
                  <span className="h-1 overflow-hidden rounded-pill bg-surface-3">
                    <motion.span
                      className="block h-full rounded-pill bg-accent"
                      initial={false}
                      animate={{ width: i <= step ? "100%" : "0%" }}
                      transition={{ duration: reduced ? 0 : 0.24, ease: "easeOut" }}
                    />
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors duration-150",
                      i === step ? "text-tsecondary" : "text-ttertiary",
                    )}
                  >
                    {i < step && <Check size={10} className="text-accent" />}
                    {`0${i + 1} · ${label}`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ---------- step content: direction-aware crossfade ---------- */}
          <div className="relative mt-7 min-h-[420px]">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                initial={reduced ? false : { opacity: 0, x: dir * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: dir * -18 }}
                transition={{ duration: reduced ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-[24px] bg-surface-1 p-8 shadow-elev1"
              >
                {step === 0 && <StepLang current={current} onPick={changeLang} />}
                {step === 1 && <StepAccent accent={accent} onPick={(hex) => void setAccent(hex)} />}
                {step === 2 && (
                  <StepInterface
                    mainLayout={mainLayout}
                    cardHover={cardHover}
                    gridDensity={gridDensity}
                    uiRadius={uiRadius}
                    uiMotion={uiMotion}
                    onLayout={(v) => void setMainLayout(v)}
                    onCardHover={(v) => void setCardHover(v)}
                    onDensity={(v) => void setGridDensity(v)}
                    onRadius={(v) => void setUiRadius(v)}
                    onMotion={(v) => void setUiMotion(v)}
                  />
                )}
                {step === 3 && (
                  <StepBehavior
                    videoAutoplay={videoAutoplay}
                    swipeNavigate={swipeNavigate}
                    hoverCaptions={hoverCaptions}
                    backgroundMode={backgroundMode}
                    onAutoplay={(v) => void setVideoAutoplay(v)}
                    onSwipe={(v) => void setSwipeNavigate(v)}
                    onCaptions={(v) => void setHoverCaptions(v)}
                    onBackground={(v) => void setBackgroundMode(v)}
                  />
                )}
                {atFinish && (
                  <FinishPanel
                    language={current}
                    accent={accent}
                    mainLayout={mainLayout}
                    density={gridDensity}
                    radius={uiRadius}
                    motionOn={uiMotion}
                    autoplay={videoAutoplay}
                    background={backgroundMode}
                    onStart={onDone}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ---------- footer nav ---------- */}
          <div className="mt-7 flex items-center justify-between">
            <button
              type="button"
              onClick={back}
              className={cn(
                "flex h-11 items-center gap-2 rounded-pill px-5 text-sm text-tsecondary",
                "transition-all duration-[160ms] ease-out",
                step === 0
                  ? "pointer-events-none opacity-0"
                  : "hover:bg-white/[.06] hover:text-tprimary active:scale-[.97]",
              )}
            >
              <ArrowLeft size={16} /> {t("setup.back")}
            </button>

            {/* the primary CTA disappears at the end of the road — no hidden
                focusable button, and nothing left to "advance" into */}
            {!atFinish && (
              <button
                type="button"
                onClick={() => void next()}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-pill px-6 text-sm font-medium text-[#0A0A0C]",
                  "transition-all duration-[160ms] ease-out hover:brightness-110 active:scale-[.97]",
                )}
                style={{ background: accent }}
              >
                {step === LAST_STEP ? (
                  <>
                    <Check size={16} /> {t("setup.finish")}
                  </>
                ) : (
                  <>
                    {t("setup.next")} <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}
          </div>

          {/* skip is always available — a wizard must never be a wall */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={onDone}
              className="rounded-pill px-3 py-1.5 text-[12px] text-ttertiary transition-colors hover:text-tsecondary"
            >
              {t("setup.skip")}
            </button>
          </div>
        </div>

        {/* ---------------- live preview column ---------------- */}
        <aside className="sticky top-10 hidden w-[312px] shrink-0 lg:block">
          <LivePreview
            accent={accent}
            density={gridDensity}
            radius={uiRadius}
            layout={mainLayout}
            cardHover={cardHover}
          />
        </aside>
      </div>
    </div>
  );
}

/* ================= step 1: language ================= */

function StepLang({ current, onPick }: { current: Lang; onPick: (l: Lang) => void }) {
  const { t } = useTranslation();
  return (
    <OptionGroup
      icon={<Languages size={18} className="text-accent" />}
      title={t("setup.lang_title")}
      hint={t("setup.lang_hint")}
    >
      <div className="mt-6 grid grid-cols-2 gap-3">
        {LOCALES.map((l) => (
          <OptionCard key={l.code} active={l.code === current} onClick={() => onPick(l.code)}>
            <span className="text-base font-semibold text-tprimary">{l.nativeName}</span>
            <span className="font-mono text-[11px] text-ttertiary">{l.code.toUpperCase()}</span>
          </OptionCard>
        ))}
      </div>
    </OptionGroup>
  );
}

/* ================= step 2: accent ================= */

function StepAccent({ accent, onPick }: { accent: string; onPick: (hex: string) => void }) {
  const { t } = useTranslation();
  return (
    <OptionGroup
      icon={<Palette size={18} className="text-accent" />}
      title={t("setup.accent_title")}
      hint={t("setup.accent_hint")}
    >
      <div className="mt-6 flex flex-wrap gap-3">
        {ACCENTS.map((preset) => {
          const active = accent.toLowerCase() === preset.hex.toLowerCase();
          return (
            <button
              key={preset.id}
              type="button"
              title={t(preset.labelKey)}
              aria-label={t(preset.labelKey)}
              aria-pressed={active}
              onClick={() => onPick(preset.hex)}
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-[16px] transition-all duration-[160ms] ease-out active:scale-[.94]",
                active
                  ? "scale-105 shadow-[0_0_0_2px_var(--surface-1),0_0_0_4px_var(--accent)]"
                  : "opacity-85 hover:scale-105 hover:opacity-100",
              )}
              style={{ background: preset.hex }}
            >
              {active && <Check size={18} strokeWidth={3} className="text-[#0A0A0C]" />}
            </button>
          );
        })}
      </div>

      {/* live preview strip: every accent anchor the library uses, repainting
          under the pointer as the user scrubs the swatches */}
      <div className="mt-8 flex items-center gap-3 rounded-[16px] border border-hairline bg-surface-2 p-4">
        <span className="rounded-pill bg-accent px-4 py-1.5 text-[12px] font-medium text-[#0A0A0C]">
          {t("setup.preview_active")}
        </span>
        <span className="rounded-pill bg-accent/[.14] px-4 py-1.5 text-[12px] text-accent">
          {t("setup.preview_tint")}
        </span>
        <span className="h-2 flex-1 rounded-pill bg-surface-3">
          <span className="block h-full w-1/3 rounded-pill bg-accent" />
        </span>
      </div>
    </OptionGroup>
  );
}

/* ================= step 3: interface ================= */

function StepInterface({
  mainLayout,
  cardHover,
  gridDensity,
  uiRadius,
  uiMotion,
  onLayout,
  onCardHover,
  onDensity,
  onRadius,
  onMotion,
}: {
  mainLayout: MainLayout;
  cardHover: boolean;
  gridDensity: GridDensity;
  uiRadius: UiRadius;
  uiMotion: boolean;
  onLayout: (v: MainLayout) => void;
  onCardHover: (v: boolean) => void;
  onDensity: (v: GridDensity) => void;
  onRadius: (v: UiRadius) => void;
  onMotion: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <OptionGroup
      icon={<SlidersHorizontal size={18} className="text-accent" />}
      title={t("setup.interface_title")}
      hint={t("setup.interface_hint")}
    >
      <div className="mt-6 grid grid-cols-2 gap-3">
        <OptionCard active={mainLayout === "classic"} onClick={() => onLayout("classic")}>
          <LayoutDiagram kind="classic" active={mainLayout === "classic"} />
          <span className="text-sm font-medium text-tprimary">
            {t("settings.main_layout_classic")}
          </span>
        </OptionCard>
        <OptionCard active={mainLayout === "rail"} onClick={() => onLayout("rail")}>
          <LayoutDiagram kind="rail" active={mainLayout === "rail"} />
          <span className="text-sm font-medium text-tprimary">{t("settings.main_layout_rail")}</span>
        </OptionCard>
      </div>

      <div className="mt-6">
        <Toggle
          label={t("settings.card_hover")}
          hint={t("settings.card_hover_hint")}
          on={cardHover}
          onChange={onCardHover}
        />
        <Toggle
          label={t("settings.ui_motion")}
          hint={t("settings.ui_motion_hint")}
          on={uiMotion}
          onChange={onMotion}
        />
      </div>

      {/* density */}
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-tprimary">{t("settings.grid_density")}</span>
          <span className="text-[12px] text-ttertiary">
            {t("settings.grid_density_hint", {
              h: DENSITY_PARAMS[gridDensity].targetH,
              gap: DENSITY_PARAMS[gridDensity].gap,
            })}
          </span>
        </span>
        <PillChoice<GridDensity>
          ariaLabel={t("settings.grid_density")}
          value={gridDensity}
          onChange={onDensity}
          options={(["comfort", "medium", "compact"] as GridDensity[]).map((d) => ({
            value: d,
            label: t(`settings.density_${d}`),
          }))}
        />
      </div>

      {/* corners */}
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-tprimary">{t("settings.corners")}</span>
          <span className="text-[12px] text-ttertiary">{t("settings.corners_hint")}</span>
        </span>
        <PillChoice<UiRadius>
          ariaLabel={t("settings.corners")}
          value={uiRadius}
          onChange={onRadius}
          options={RADIUS_PRESETS.map((r) => ({ value: r.id, label: t(r.labelKey) }))}
        />
      </div>
    </OptionGroup>
  );
}

/* ================= step 4: behavior ================= */

function StepBehavior({
  videoAutoplay,
  swipeNavigate,
  hoverCaptions,
  backgroundMode,
  onAutoplay,
  onSwipe,
  onCaptions,
  onBackground,
}: {
  videoAutoplay: boolean;
  swipeNavigate: boolean;
  hoverCaptions: boolean;
  backgroundMode: boolean;
  onAutoplay: (v: boolean) => void;
  onSwipe: (v: boolean) => void;
  onCaptions: (v: boolean) => void;
  onBackground: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <OptionGroup
      icon={<MousePointerClick size={18} className="text-accent" />}
      title={t("setup.behavior_title")}
      hint={t("setup.behavior_hint")}
    >
      <div className="mt-6">
        <Toggle
          label={t("settings.video_autoplay")}
          hint={t("settings.video_autoplay_hint")}
          on={videoAutoplay}
          onChange={onAutoplay}
        />
        <Toggle
          label={t("settings.swipe_navigate")}
          hint={t("settings.swipe_hint")}
          on={swipeNavigate}
          onChange={onSwipe}
        />
        <Toggle
          label={t("settings.hover_captions")}
          hint={t("settings.hover_captions_hint")}
          on={hoverCaptions}
          onChange={onCaptions}
        />
        <Toggle
          label={t("settings.background_mode")}
          hint={t("settings.background_mode_hint")}
          on={backgroundMode}
          onChange={onBackground}
        />
      </div>
    </OptionGroup>
  );
}

/* ================= finish ================= */

function FinishPanel({
  language,
  accent,
  mainLayout,
  density,
  radius,
  motionOn,
  autoplay,
  background,
  onStart,
}: {
  language: Lang;
  accent: string;
  mainLayout: MainLayout;
  density: GridDensity;
  radius: UiRadius;
  /** named `motionOn` — `motion` is the framer import in this file */
  motionOn: boolean;
  autoplay: boolean;
  background: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const radiusKey = RADIUS_PRESETS.find((r) => r.id === radius)?.labelKey ?? "settings.radius_default";

  const summary: string[] = [
    language === "ru" ? "Русский" : "English",
    t(`settings.density_${density}`),
    mainLayout === "rail" ? t("settings.main_layout_rail") : t("settings.main_layout_classic"),
    t(radiusKey),
    motionOn ? t("setup.sum_motion_on") : t("setup.sum_motion_off"),
    autoplay ? t("setup.sum_autoplay_on") : t("setup.sum_autoplay_off"),
    background ? t("setup.sum_tray_on") : t("setup.sum_tray_off"),
  ];

  return (
    <div className="flex flex-col items-center py-2 text-center">
      <motion.span
        initial={reduced ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/[.16]"
        style={{ boxShadow: "0 0 0 1px var(--accent-soft), 0 12px 32px var(--accent-soft)" }}
      >
        <Check size={38} strokeWidth={2.5} className="text-accent" />
      </motion.span>

      <h2 className="mt-6 text-2xl font-semibold text-tprimary">{t("setup.done_title")}</h2>
      <p className="mt-2 max-w-md text-[14px] text-tsecondary">{t("setup.done_hint")}</p>

      <div className="mt-6 flex max-w-lg flex-wrap items-center justify-center gap-2">
        {summary.map((s) => (
          <span
            key={s}
            className="rounded-pill bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-tsecondary"
          >
            {s}
          </span>
        ))}
        <span
          className="rounded-pill px-3 py-1.5 font-mono text-[11px] text-[#0A0A0C]"
          style={{ background: accent }}
        >
          {t("setup.sum_accent")}
        </span>
      </div>

      <button
        type="button"
        onClick={onStart}
        className={cn(
          "mt-8 flex h-12 items-center gap-2 rounded-pill px-7 text-sm font-semibold text-[#0A0A0C]",
          "transition-all duration-[160ms] ease-out hover:brightness-110 active:scale-[.97]",
        )}
        style={{ background: accent }}
      >
        {t("setup.done_cta")} <ArrowRight size={16} />
      </button>
      <p className="mt-3 text-[12px] text-ttertiary">{t("setup.done_note")}</p>
    </div>
  );
}

/* ================= live preview ================= */

/**
 * A miniature of the library that reads the REAL settings store: sidebar vs
 * rail, density, corner language, card hover. Changing a control repaints it
 * instantly, so the wizard always shows a consequence, never just a label.
 */
function LivePreview({
  accent,
  density,
  radius,
  layout,
  cardHover,
}: {
  accent: string;
  density: GridDensity;
  radius: UiRadius;
  layout: MainLayout;
  cardHover: boolean;
}) {
  const { t } = useTranslation();
  const gap = Math.max(4, DENSITY_PARAMS[density].gap / 2);
  const cardRadius = radius === "sharp" ? 6 : radius === "round" ? 16 : 10;
  const rail = layout === "rail";

  const tiles = [
    { h: 46, icon: <Images size={13} className="text-accent" /> },
    { h: 64, icon: <Film size={13} className="text-accent" /> },
    { h: 54, icon: <Heart size={13} className="text-accent" /> },
    { h: 38, icon: <Clock size={13} className="text-accent" /> },
  ];

  return (
    <div className="overflow-hidden rounded-[20px] bg-surface-1 p-3 shadow-elev1">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Layers size={13} className="text-ttertiary" />
        <span className="micro-label">{t("setup.preview_title")}</span>
      </div>

      <div
        className="flex overflow-hidden rounded-[14px] bg-canvas"
        style={{ height: 258 }}
      >
        {/* shell chrome */}
        {rail ? (
          <div className="flex flex-1 flex-col">
            <div className="flex h-7 items-center gap-1.5 border-b border-hairline px-2">
              <span className="h-2 w-10 rounded-pill bg-surface-3" />
              <span className="ml-auto h-2 w-6 rounded-pill" style={{ background: accent, opacity: 0.7 }} />
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex w-7 flex-col items-center gap-1.5 border-r border-hairline py-2">
                <span className="h-3.5 w-3.5 rounded-[5px]" style={{ background: accent, opacity: 0.85 }} />
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-3.5 w-3.5 rounded-[5px] bg-surface-3" />
                ))}
              </div>
              <PreviewGrid gap={gap} cardRadius={cardRadius} tiles={tiles} cardHover={cardHover} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1">
            <div className="flex w-[74px] shrink-0 flex-col gap-1 border-r border-hairline p-1.5">
              <span className="mb-1 h-1.5 w-8 rounded-pill bg-surface-3" />
              <span
                className="h-5 rounded-[7px]"
                style={{ background: "var(--accent-soft)", boxShadow: `inset 0 0 0 1px ${accent}55` }}
              />
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-5 rounded-[7px] bg-surface-2" />
              ))}
              <span className="mt-auto h-1.5 w-12 rounded-pill bg-surface-3" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-7 items-center gap-1.5 border-b border-hairline px-2">
                <span className="h-1.5 w-12 rounded-pill bg-surface-3" />
                <span className="ml-auto h-4 w-16 rounded-pill bg-surface-2" />
              </div>
              <PreviewGrid gap={gap} cardRadius={cardRadius} tiles={tiles} cardHover={cardHover} />
            </div>
          </div>
        )}
      </div>

      <p className="mt-2 px-1 text-[11px] leading-snug text-ttertiary">{t("setup.preview_hint")}</p>
    </div>
  );
}

function PreviewGrid({
  gap,
  cardRadius,
  tiles,
  cardHover,
}: {
  gap: number;
  cardRadius: number;
  tiles: { h: number; icon: React.ReactNode }[];
  cardHover: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 p-2">
      <div className="mb-1.5 h-1.5 w-14 rounded-pill bg-surface-3" />
      <div className="flex" style={{ gap }}>
        {[0, 1, 2].map((col) => (
          <div key={col} className="flex flex-1 flex-col" style={{ gap }}>
            {tiles
              .filter((_, i) => i % 3 === col % 3 || col === 1)
              .slice(0, col === 1 ? 3 : 2)
              .map((tile, i) => (
                <div
                  key={i}
                  className={cn(
                    "relative bg-surface-2 transition-transform duration-200",
                    cardHover && "hover:-translate-y-0.5",
                  )}
                  style={{ height: tile.h, borderRadius: cardRadius }}
                >
                  <span className="absolute right-1 bottom-1 opacity-70">{tile.icon}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= shared pieces ================= */

function OptionGroup({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent/[.14]">
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-tprimary">{title}</h2>
          <p className="text-[13px] text-ttertiary">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function OptionCard({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[72px] flex-col items-start justify-center gap-2 rounded-[16px] border p-4 text-left",
        "transition-all duration-[160ms] ease-out active:scale-[.98]",
        active
          ? "border-accent/60 bg-accent/[.10] shadow-[0_0_0_1px_var(--accent-soft)]"
          : "border-hairline bg-surface-2 hover:border-white/15 hover:bg-white/[.04]",
      )}
    >
      {children}
    </button>
  );
}

