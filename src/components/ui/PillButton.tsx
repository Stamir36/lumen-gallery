import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillButtonVariants = cva(
  // Pill shape, height 32px min, pressed scale .98, hover 160ms ease-out
  "inline-flex h-8 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium " +
    "transition-all duration-[160ms] ease-out " +
    "active:scale-[.98] disabled:pointer-events-none disabled:opacity-40 select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        // Primary: white bg + black text
        primary: "bg-white text-black hover:bg-white/90",
        // Ghost: hairline border, transparent bg
        ghost:
          "border border-hairline text-tprimary hover:border-hairline-hover hover:bg-surface-2",
        danger: "border border-hairline text-danger hover:bg-surface-2",
      },
      size: {
        sm: "h-7 px-3 text-[13px]",
        md: "h-8 px-4",
        lg: "h-10 px-5",
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
