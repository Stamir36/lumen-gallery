import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Chunky Segmented v2 (DESIGN.md v2 §7, §10): h-44 pill, glass bg,
 * active segment surface-3 + primary text, layout-animated thumb.
 */
export interface SegmentedProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        // solid surface-2 track — NO blur (glass whitelist v2.2)
        "inline-flex h-11 items-center gap-1 rounded-pill bg-surface-2 p-1",
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
              "relative inline-flex h-10 items-center gap-2 rounded-pill px-5",
              "transition-colors duration-[160ms] ease-out active:scale-[.97]",
              active
                ? "text-[#0A0A0C]" // solid accent anchor: accent bg, canvas text
                : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="absolute inset-0 rounded-pill bg-accent shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_4px_12px_var(--accent-strong)]"
              />
            )}
            {opt.icon && <span className="relative z-10">{opt.icon}</span>}
            <span className="relative z-10 text-sm font-medium whitespace-nowrap">
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
