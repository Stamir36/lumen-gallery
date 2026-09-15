import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * GlassTopBar v2.2: 64px, SOLID surface-1 + bottom editorial hairline.
 * (No backdrop-filter on structural chrome — glass whitelist §3.)
 */
export function GlassTopBar({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-16 shrink-0 items-center gap-5 border-b border-hairline bg-surface-1 px-10",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{left}</div>
      {center && <div className="flex items-center gap-4">{center}</div>}
      <div className="flex flex-1 items-center justify-end gap-3">{right}</div>
    </header>
  );
}

/** Display page title with optional mono count (metadata only). */
export function TopBarTitle({
  title,
  count,
}: {
  title: string;
  count?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="truncate text-lg font-semibold text-tprimary">{title}</span>
      {count && (
        <span className="font-mono text-[11px] tracking-[0.08em] text-ttertiary">
          {count}
        </span>
      )}
    </div>
  );
}
