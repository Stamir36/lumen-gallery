import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * GlassCard v2 (DESIGN.md v2 §10): radius-card, surface-1, elev-1,
 * padding 24-28. Optional hover lift.
 */
export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  children?: ReactNode;
}

export function GlassCard({
  className,
  hover,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-card bg-surface-1 p-7 shadow-elev1",
        hover && "hover-lift cursor-pointer",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
