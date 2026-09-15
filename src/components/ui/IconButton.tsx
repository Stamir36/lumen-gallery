import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * 32×32 icon button, radius-control, hover surface-2 fill.
 * Hit area is exactly 32px per DESIGN.md §6.2.
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
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control " +
          "text-tsecondary transition-colors duration-[160ms] ease-out " +
          "hover:bg-surface-2 hover:text-tprimary active:scale-[.98] " +
          "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
