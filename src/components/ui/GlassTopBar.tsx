import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 48px glass top bar per DESIGN.md §6.5:
 * canvas ~70% opacity + backdrop-blur, hairline bottom border.
 * Slots: left (breadcrumb/title + mono count), center, right (controls).
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
        "glass sticky top-0 z-40 flex h-12 shrink-0 items-center gap-4",
        "border-b border-hairline px-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{left}</div>
      {center && <div className="flex items-center gap-3">{center}</div>}
      <div className="flex flex-1 items-center justify-end gap-3">{right}</div>
    </header>
  );
}

/** Breadcrumb/title with optional mono count. */
export function TopBarTitle({
  title,
  count,
}: {
  title: string;
  count?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <span className="truncate text-sm font-medium text-tprimary">
        {title}
      </span>
      {count && (
        <span className="font-mono text-[11px] tracking-[0.08em] text-ttertiary">
          {count}
        </span>
      )}
    </div>
  );
}
