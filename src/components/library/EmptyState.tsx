import { SearchX, HardDrive, RefreshCw } from "lucide-react";

/**
 * Empty state per DESIGN.md §10: dashed hairline box + mono label (+ a real
 * CTA, never a dead end).
 */
export function EmptyState({
  title,
  mono,
  cta,
  onCta,
  icon = "empty",
}: {
  title: string;
  mono?: string;
  cta?: string;
  onCta?: () => void;
  icon?: "empty" | "search" | "error";
}) {
  const Icon = icon === "search" ? SearchX : HardDrive;
  return (
    <div className="flex h-full items-center justify-center px-9 pb-16">
      <div className="flex w-full max-w-[520px] flex-col items-center gap-5 rounded-card border border-dashed border-white/12 px-10 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-surface-2 text-ttertiary">
          {icon === "error" ? <RefreshCw size={20} /> : <Icon size={20} />}
        </span>
        <div className="text-lg font-semibold text-tprimary">{title}</div>
        {mono && (
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ttertiary">
            {mono}
          </div>
        )}
        {cta && onCta && (
          <button
            type="button"
            onClick={onCta}
            className="mt-1 inline-flex h-12 items-center gap-2 rounded-pill bg-tprimary px-6 text-sm font-medium text-[#0A0A0C] transition-all duration-[160ms] ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.18)] active:scale-[.97]"
          >
            {cta}
          </button>
        )}
      </div>
    </div>
  );
}
