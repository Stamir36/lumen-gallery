import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
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
import { SCRUB_RATES, useAppSettings } from "@/lib/settings";
import { LanguageDropdown } from "@/components/LanguageSwitcher";
import { GlassCard } from "@/components/ui/GlassCard";
import { PillButton } from "@/components/ui/PillButton";
import { IconButton } from "@/components/ui/IconButton";
import { api, formatBytes, type RootRow } from "@/lib/api";
import { resetThumbs } from "@/lib/thumbs";
import { queryClient } from "@/lib/queryClient";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";
import {
  readSetting,
  writeSetting,
  CURSOR_KEY,
} from "@/i18n";

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

function SoonRow({
  label,
  soon,
}: {
  label: string;
  soon: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-hairline py-4 opacity-50">
      <span className="text-sm text-tsecondary">{label}</span>
      <span className="font-mono text-[11px] text-ttertiary">{soon}</span>
    </div>
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
  const swipeNavigate = useAppSettings((s) => s.swipeNavigate);
  const setSwipeNavigate = useAppSettings((s) => s.setSwipeNavigate);
  const pillAlign = useAppSettings((s) => s.pillAlign);
  const setPillAlign = useAppSettings((s) => s.setPillAlign);

  useEffect(() => {
    void readSetting(CURSOR_KEY).then((v) =>
      setCursorPointer(v === "true"),
    );
  }, []);

  const toggleCursor = async (on: boolean) => {
    setCursorPointer(on);
    try {
      await writeSetting(CURSOR_KEY, String(on));
    } catch {
      /* class already applied optimistically */
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
      } catch {
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
    } catch {
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

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

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
            <div className="mt-2 flex items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">{t("settings.theme")}</span>
              <span className="text-sm text-tsecondary">{t("settings.dark")}</span>
            </div>
            <div className="flex items-center justify-between border-t border-hairline py-4">
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
            <div className="flex items-center justify-between border-t border-hairline py-4">
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
            <div className="flex items-center justify-between border-t border-hairline py-4">
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
            <div className="flex items-center justify-between border-t border-hairline py-4">
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
            <SoonRow label={t("settings.accent_color")} soon={t("settings.soon")} />
            <SoonRow label={t("settings.grid_density")} soon={t("settings.soon")} />
          </GlassCard>
        </Section>

        {/* 03 Playback */}
        <Section index="03" id="playback" title={t("settings.nav_playback")}>
          <GlassCard>
            <div className="flex flex-wrap items-center justify-between gap-4">
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
              <PillButton className="mt-4" type="submit" disabled={!ready || busy}>
                {t("settings.save")}
              </PillButton>
            </form>
            <div className="mt-2 flex items-center justify-between border-t border-hairline py-4">
              <span className="text-sm text-tprimary">{t("settings.version")}</span>
              <span className="font-mono text-[12px] text-ttertiary">0.1.0</span>
            </div>
            <SoonRow
              label={t("settings.associations")}
              soon={t("settings.soon")}
            />
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
