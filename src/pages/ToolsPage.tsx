import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Copy, HardDrive } from "lucide-react";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { IconButton } from "@/components/ui/IconButton";
import { formatBytes, formatCount } from "@/lib/api";
import { useLibrarySummary } from "@/lib/queries";
import { useAppSettings } from "@/lib/settings";

/**
 * Tools hub — every instrument of the app lives on one screen, so the sidebar
 * stays a pure library list. New tools are added to TOOLS; nothing else.
 *
 * DESIGN.md v2.5: cards are tonal elevation on surface-1 (no gradients, no
 * glass — cards are on the glass whitelist's forbidden list), hover = lift +
 * glow, mono only for metadata. The oversized thin accent numbers ("01", "02")
 * are the editorial anchor allowed by §3.3.4; each card's meta line is live
 * data from the library summary, so the hub reads like a dashboard, not a menu.
 * Page chrome mirrors /settings: full screen with its own WindowTitleBar.
 */

interface SummaryShape {
  total: number;
  bytes: number;
  images: number;
}

interface ToolCard {
  id: string;
  route: string;
  index: string;
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
  meta: (t: (key: string, opts?: Record<string, unknown>) => string, s: SummaryShape | undefined) => string;
}

/**
 * NOTE: the memory game ("/play") is a hidden easter egg — it must NOT appear
 * here, not even for dev-unlocked users. It is reachable only by typing the
 * route (see PlayPage). Do not add it back to this list.
 */
const TOOLS: ToolCard[] = [
  {
    id: "duplicates",
    route: "/duplicates",
    index: "01",
    icon: <Copy size={20} strokeWidth={1.7} />,
    titleKey: "tools.duplicates_title",
    descKey: "tools.duplicates_desc",
    meta: (t, s) => t("tools.meta_files", { count: formatCount(s?.total ?? 0) }),
  },
  {
    id: "disk",
    route: "/disk",
    index: "02",
    icon: <HardDrive size={20} strokeWidth={1.7} />,
    titleKey: "tools.disk_title",
    descKey: "tools.disk_desc",
    meta: (t, s) => t("tools.meta_bytes", { bytes: formatBytes(s?.bytes ?? 0) }),
  },
];

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
};

export default function ToolsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summary = useLibrarySummary(true);
  const uiMotion = useAppSettings((s) => s.uiMotion);

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar
        leftAction={
          <IconButton label={t("actions.back")} onClick={() => navigate("/")}>
            <ArrowLeft size={18} />
          </IconButton>
        }
      />
      <main className="relative min-h-0 flex-1 overflow-y-auto px-10 py-12">
        {/* the accent wash sits on the PAGE (settings precedent), not on cards */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
          style={{
            background:
              "radial-gradient(60% 70% at 24% 0%, var(--accent-soft), transparent 70%)",
            opacity: 0.7,
          }}
        />
        <motion.div
          className="relative mx-auto max-w-[880px]"
          initial={uiMotion ? { opacity: 0, y: 10 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* editorial header: display title + one-line hint (the sidebar row
              is the micro-label surface for this section — no dup label here) */}
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-tprimary">
            {t("tools.heading")}
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-tsecondary">
            {t("tools.hint")}
          </p>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TOOLS.map((tool, i) => (
              <motion.button
                key={tool.id}
                type="button"
                onClick={() => navigate(tool.route)}
                aria-label={t(tool.titleKey)}
                initial={uiMotion ? cardMotion.initial : false}
                animate={cardMotion.animate}
                transition={{
                  ...cardMotion.transition,
                  delay: uiMotion ? 0.06 * i : 0,
                }}
                // hover = lift + glow (DESIGN.md §2/§8); press = .97
                whileHover={uiMotion ? { y: -2 } : undefined}
                whileTap={uiMotion ? { scale: 0.97 } : undefined}
                className="group relative overflow-hidden rounded-card bg-surface-1 p-7 text-left shadow-[0_8px_24px_rgba(0,0,0,.35)] outline-none transition-shadow duration-[160ms] focus-visible:ring-2 focus-visible:ring-accent/40 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.18)]"
              >
                {/* editorial section number — one of the ≤5 accent anchors */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-6 top-5 select-none text-[34px] font-[300] leading-none text-accent"
                >
                  {tool.index}
                </span>

                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-tprimary transition-colors duration-[160ms] group-hover:bg-surface-3">
                  {tool.icon}
                </span>
                <span className="mt-5 block text-[18px] font-[600] leading-snug text-tprimary">
                  {t(tool.titleKey)}
                </span>
                <span className="mt-2 block text-[13.5px] leading-relaxed text-tsecondary">
                  {t(tool.descKey)}
                </span>

                {/* live metadata (mono, tabular) + hover arrow affordance */}
                <span className="mt-6 flex items-center gap-2 font-mono text-[11px] tabular-nums text-ttertiary">
                  {tool.meta(t, summary.data)}
                  <ArrowRight
                    size={14}
                    className="ml-auto translate-x-0 transition-transform duration-[160ms] group-hover:translate-x-1 group-hover:text-tprimary"
                  />
                </span>
              </motion.button>
            ))}

            {/* placeholder in the empty-state recipe: dashed hairline + mono label */}
            <div className="flex min-h-[168px] items-center justify-center rounded-card border border-dashed border-hairline">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ttertiary">
                {t("tools.soon")}
              </span>
            </div>
          </div>

          <p className="mt-12 border-t border-hairline pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ttertiary">
            {t("tools.library_line", { count: formatCount(summary.data?.total ?? 0) })}
          </p>
        </motion.div>
      </main>
    </div>
  );
}
