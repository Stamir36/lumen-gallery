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

/**
 * Mono chip for metadata printed OVER media (grid cards, list rows, offline
 * tiles). Same recipe everywhere = "mono chips unified" (§6/§10): dark tonal
 * fill, no blur — blur stays on the floating pills whitelist only.
 */
export function MonoChip({
  className,
  tone = "media",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "media" | "tonal" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-pill px-2 font-mono text-[11px] tracking-[0.04em]",
        tone === "media" ? "bg-black/55 text-white/90" : "bg-white/[.06] text-tsecondary",
        className,
      )}
      {...props}
    />
  );
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
