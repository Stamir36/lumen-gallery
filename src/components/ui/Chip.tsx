import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Chip: pill, hairline border, 11–12px. Mono variant for numeric/meta
 * chips (duration, resolution, res-fps-codec) per DESIGN.md §6.4.
 */
export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  mono?: boolean;
  accent?: boolean;
}

export function Chip({ className, mono, accent, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-pill border border-hairline bg-black/30 px-2.5",
        mono
          ? "font-mono text-[11px] tracking-[0.04em]"
          : "text-xs text-tsecondary",
        accent
          ? "text-accent border-accent/30"
          : "text-tsecondary",
        className,
      )}
      {...props}
    />
  );
}
