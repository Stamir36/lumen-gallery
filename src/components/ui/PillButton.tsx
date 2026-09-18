import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillButtonVariants = cva(
  // Chunky pill h-44, tonal, pressed .97, hover lift (DESIGN.md v2 §7, §8)
  "inline-flex h-11 items-center justify-center gap-2 rounded-pill px-6 text-sm font-medium " +
    "transition-all duration-[160ms] ease-out " +
    "active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        // Primary: white bg + black text, elev-1, hover lift
        primary:
          "bg-white text-black shadow-elev1 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_var(--accent-soft)] active:translate-y-0",
        // Ghost: tonal surface-2 (no border), hover surface-3 + lift
        ghost:
          "bg-surface-2 text-tprimary hover:bg-surface-3 hover:-translate-y-0.5 hover:shadow-elev1 active:translate-y-0",
        danger: "bg-surface-2 text-danger hover:bg-surface-3",
      },
      size: {
        sm: "h-9 px-4 text-[13px]",
        md: "h-11 px-6",
        lg: "h-12 px-7",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface PillButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillButtonVariants> {}

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(pillButtonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
PillButton.displayName = "PillButton";
