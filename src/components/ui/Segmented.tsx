import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Segmented control (pill) per DESIGN.md §6.3:
 * pill container, surface-1 bg, hairline border;
 * active segment surface-2 fill + primary text; inactive secondary.
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
        "inline-flex h-8 items-center gap-0.5 rounded-pill border border-hairline bg-surface-1 p-0.5",
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
              "relative inline-flex h-7 items-center gap-1.5 rounded-pill px-3",
              "transition-colors duration-[160ms] ease-out active:scale-[.98]",
              active
                ? "text-tprimary"
                : "text-tsecondary hover:text-tprimary",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="absolute inset-0 rounded-pill bg-surface-2"
              />
            )}
            {opt.icon && <span className="relative z-10">{opt.icon}</span>}
            <span className="relative z-10 text-[13px] font-medium whitespace-nowrap">
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
