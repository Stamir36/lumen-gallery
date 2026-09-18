import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Chunky icon button 40×40, radius-control, tonal.
 * Hover: surface-2 + lift + faint glow. Hit area ≥ 40px (DESIGN.md v2 §7).
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // accessible name — required
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control " +
          "text-tsecondary transition-all duration-[160ms] ease-out " +
          "hover:bg-surface-2 hover:text-tprimary hover:-translate-y-0.5 " +
          "hover:shadow-[0_8px_24px_rgba(0,0,0,.35),0_0_0_1px_var(--accent-soft)] " +
          "active:translate-y-0 active:scale-[.97] " +
          "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
