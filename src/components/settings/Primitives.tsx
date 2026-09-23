import { cn } from "@/lib/utils";

/**
 * Settings primitives (UI audit).
 *
 * The settings page had grown ten hand-copied switch blocks with slightly
 * different paddings and three near-identical pill groups. These four pieces
 * are the shared vocabulary: one row rhythm, one switch, one segmented pill
 * group. Every row keeps its ARIA contract (`role="switch"` + accessible name),
 * which is what the e2e specs and keyboard users read.
 */

/** A labelled row: label + optional hint on the left, control on the right. */
export function SettingRow({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // hairline between rows only — tone, not boxes (DESIGN v2.4)
        "flex min-h-[64px] items-center justify-between gap-6 border-t border-hairline py-4",
        "first:border-t-0 first:pt-0 last:pb-0",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-tprimary">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ttertiary">{hint}</span>}
      </span>
      {children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
    </div>
  );
}

/** The one switch in the app: h-6×w-11 pill, accent when on. */
export function Toggle({
  on,
  onChange,
  label,
  hint,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[64px] items-center justify-between gap-6 border-t border-hairline py-4",
        "first:border-t-0 first:pt-0 last:pb-0",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-tprimary">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ttertiary">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out",
          on ? "bg-accent" : "bg-surface-3 hover:bg-surface-3/80",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow-[0_1px_3px_rgba(0,0,0,.4)]",
            "transition-all duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** Tonal pill group for small enumerated choices (density, workers, corners). */
export function PillChoice<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex shrink-0 items-center gap-0.5 rounded-pill bg-surface-3 p-1", className)}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center rounded-pill px-3 font-mono text-[12px]",
            "transition-colors duration-[160ms] ease-out",
            value === o.value
              ? "bg-white/[.14] text-tprimary"
              : "text-tsecondary hover:text-tprimary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
