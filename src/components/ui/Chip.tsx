import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Chip v2: pill, glass tonal fill, mono for meta (duration, resolution,
 * res-fps-codec). 12px. No hairline — tonal fill only.
 */
export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  mono?: boolean;
  accent?: boolean;
}

export function Chip({ className, mono, accent, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-pill bg-white/5 px-3 backdrop-blur-xl",
        mono
          ? "font-mono text-[12px] tracking-[0.04em]"
          : "text-xs text-tsecondary",
        accent ? "text-accent" : "text-tsecondary",
        className,
      )}
      {...props}
    />
  );
}
