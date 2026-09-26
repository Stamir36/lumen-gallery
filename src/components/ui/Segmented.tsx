import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Chunky Segmented v2 (DESIGN.md v2 §7, §10): h-44 pill, glass bg,
 * active segment surface-3 + primary text, layout-animated thumb.
 *
 * Two knobs exist because the chunky form is the wrong tool in a page header:
 *
 *  - `size="sm"` — 32px track. For control rows that sit next to a title, not
 *    for the primary choice on a screen.
 *  - `tone="quiet"` — the active segment is tonal (surface-3 + primary text)
 *    instead of the solid accent pill. Accent is a §3.3 anchor with a budget
 *    (3–5 per screen); a filter row is not worth one, and a bright pill in the
 *    corner of every tool page pulled the eye away from the content.
 */
export interface SegmentedProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "md" | "sm";
  tone?: "accent" | "quiet";
  "aria-label"?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  tone = "accent",
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  const id = useId();
  const small = size === "sm";
  const quiet = tone === "quiet";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-pill",
        // solid surface-2 track — NO blur (glass whitelist v2.2). The two sizes
        // carry their own complete padding/gap sets: mixing a base `p-0.5`
        // with a size `p-1` would leave the winner up to stylesheet order.
        small
          ? "h-8 gap-0.5 bg-white/[.04] p-0.5"
          : "h-11 gap-1 bg-surface-2 p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex items-center rounded-pill transition-colors duration-[160ms] ease-out active:scale-[.97]",
              small ? "h-7 gap-1.5 px-3" : "h-10 gap-2 px-5",
              active
                ? quiet
                  ? "text-tprimary"
                  : "text-[#0A0A0C]" // solid accent anchor: accent bg, canvas text
                : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className={cn(
                  "absolute inset-0 rounded-pill",
                  quiet
                    ? "bg-surface-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
                    : "bg-accent shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_4px_12px_var(--accent-strong)]",
                )}
              />
            )}
            {opt.icon && <span className="relative z-10">{opt.icon}</span>}
            <span
              className={cn(
                "relative z-10 font-medium whitespace-nowrap",
                small ? "text-[12px]" : "text-sm",
              )}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
