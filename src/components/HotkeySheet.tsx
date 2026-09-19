import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * P6 — HOTKEY CHEAT SHEET ("?").
 *
 * Every shortcut in the app was discoverable only by reading the tooltips one
 * surface at a time, so users never found the good ones (J/L, frame step,
 * shuffle, 1:1). This is ONE panel, grouped by the surface the keys belong to.
 *
 * DESIGN v2.4: a floating overlay is exactly where the dark-glass recipe is
 * whitelisted (§3.1) — dark tint, blur 28, radius 16/20, hairline edge. Keys are
 * mono chips (JetBrains-Mono-free: `.font-mono` = Space Grotesk tabular per
 * §6, which is what a key cap wants — digits stay aligned in a column).
 *
 * The listener is a capture-phase window handler, so it works over the grid, the
 * viewer AND the collage without either of them needing to know about it — and
 * "?" is not used by any of them.
 */

interface KeyRow {
  /** the physical keys, rendered as chips */
  keys: string[];
  labelKey: string;
}

const GROUPS: { id: string; titleKey: string; rows: KeyRow[] }[] = [
  {
    id: "grid",
    titleKey: "hotkeys.group_grid",
    rows: [
      { keys: ["←", "↑", "→", "↓"], labelKey: "hotkeys.grid_move" },
      { keys: ["Home", "End"], labelKey: "hotkeys.grid_ends" },
      { keys: ["Enter"], labelKey: "hotkeys.grid_open" },
      { keys: ["Space"], labelKey: "hotkeys.grid_select" },
      { keys: ["/"], labelKey: "hotkeys.grid_search" },
      { keys: ["Alt", "←"], labelKey: "hotkeys.grid_up" },
      { keys: ["?"], labelKey: "hotkeys.help" },
    ],
  },
  {
    id: "viewer",
    titleKey: "hotkeys.group_viewer",
    rows: [
      { keys: ["←", "→"], labelKey: "hotkeys.viewer_step" },
      { keys: ["0"], labelKey: "hotkeys.viewer_fit" },
      { keys: ["1"], labelKey: "hotkeys.viewer_one_to_one" },
      { keys: ["F"], labelKey: "hotkeys.favorite" },
      { keys: ["I"], labelKey: "hotkeys.info" },
      { keys: ["Esc"], labelKey: "hotkeys.viewer_close" },
    ],
  },
  {
    id: "player",
    titleKey: "hotkeys.group_player",
    rows: [
      { keys: ["Space", "K"], labelKey: "hotkeys.player_play" },
      { keys: ["J", "L"], labelKey: "hotkeys.player_jump10" },
      { keys: ["←", "→"], labelKey: "hotkeys.player_seek5" },
      { keys: ["↑", "↓"], labelKey: "hotkeys.player_volume" },
      { keys: ["M"], labelKey: "hotkeys.player_mute" },
      { keys: [",", "."], labelKey: "hotkeys.player_frame" },
      { keys: ["0–9"], labelKey: "hotkeys.player_percent" },
      { keys: ["H"], labelKey: "hotkeys.player_hide_ui" },
      { keys: ["Esc"], labelKey: "hotkeys.player_exit" },
    ],
  },
  {
    id: "collage",
    titleKey: "hotkeys.group_collage",
    rows: [{ keys: ["Esc"], labelKey: "hotkeys.collage_close" }],
  },
];

export function HotkeySheet() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        // owned by the sheet while it is up: the viewer must not close under it
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    // capture + early: stopPropagation above keeps "?" out of every other handler
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-6"
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("hotkeys.title")}
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="glass max-h-[80vh] w-[min(760px,92vw)] overflow-y-auto rounded-card p-6"
          >
            <header className="mb-5 flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <h2 className="text-[20px] font-semibold text-tprimary">{t("hotkeys.title")}</h2>
                <p className="text-[12px] text-ttertiary">{t("hotkeys.hint")}</p>
              </div>
              <button
                type="button"
                aria-label={t("viewer.close")}
                title={t("viewer.close")}
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-tsecondary transition-colors duration-[120ms] hover:bg-white/[.08] hover:text-tprimary"
              >
                <X size={16} />
              </button>
            </header>

            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <section key={g.id} aria-label={t(g.titleKey)}>
                  <h3 className="mb-2 text-[11px] font-medium tracking-[0.12em] text-ttertiary uppercase">
                    {t(g.titleKey)}
                  </h3>
                  <dl className="flex flex-col">
                    {g.rows.map((r) => (
                      <div
                        key={r.labelKey}
                        className="flex h-9 items-center justify-between gap-4"
                      >
                        <dt className="text-[13px] text-tsecondary">{t(r.labelKey)}</dt>
                        <dd className="flex shrink-0 items-center gap-1">
                          {r.keys.map((k) => (
                            <span
                              key={k}
                              className={cn(
                                "rounded-[7px] bg-white/[.08] px-2 py-0.5 font-mono text-[11px] tabular-nums text-tprimary",
                                "shadow-[inset_0_1px_0_rgba(255,255,255,.08)]",
                              )}
                            >
                              {k}
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
