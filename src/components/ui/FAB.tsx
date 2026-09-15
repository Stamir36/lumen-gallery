import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * FAB v2 (DESIGN.md v2 §7, §10): 56px, radius 20, glass elev-2,
 * hover lift + glow. Accent glyph for the primary action.
 */
export interface FABProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function FAB({ label, className, children, ...props }: FABProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "glass inline-flex h-14 w-14 items-center justify-center rounded-[20px] " +
          "text-tprimary transition-all duration-[160ms] ease-out " +
          "shadow-elev1 hover:-translate-y-1 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.25)] " +
          "active:translate-y-0 active:scale-[.97]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
