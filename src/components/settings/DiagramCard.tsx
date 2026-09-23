import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Shared diagram-card picker (BUGS 29.09 #4/#5): the wizard's OptionCard look,
 * extracted so Settings can offer the same beautiful diagram cards instead of
 * the odd one-out toggle. Used by the main-layout choice today; any enumerated
 * choice with a diagram can adopt it.
 */
export function DiagramCard({
  active,
  onClick,
  label,
  diagram,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  diagram: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[84px] flex-1 flex-col items-start justify-between gap-2",
        "rounded-[16px] border p-3.5 text-left",
        "transition-all duration-[160ms] ease-out active:scale-[.98]",
        active
          ? "border-accent/60 bg-accent/[.10] shadow-[0_0_0_1px_var(--accent-soft)]"
          : "border-hairline bg-surface-2 hover:border-white/15 hover:bg-white/[.04]",
      )}
    >
      {diagram}
      <span
        className={cn(
          "text-sm font-medium transition-colors",
          active ? "text-tprimary" : "text-tsecondary group-hover:text-tprimary",
        )}
      >
        {label}
      </span>
      {/* the check chip: appears only when active, spring-popped */}
      {active && (
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-pill bg-accent text-[#0A0A0C]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M1.5 5.2 4 7.6 8.5 2.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.span>
      )}
    </button>
  );
}
