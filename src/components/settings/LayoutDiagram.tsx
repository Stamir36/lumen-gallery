import { cn } from "@/lib/utils";
import type { MainLayout } from "@/lib/settings";

/**
 * Mini-diagram of each main-layout shell, shared by the setup wizard and the
 * Settings row (BUGS 29.09 #4/#5). Classic = sidebar + header + body; Rail =
 * tablet form: a slim icon rail LEFT of the header band, body below — the
 * actual geometry, not two near-identical slabs.
 */
export function LayoutDiagram({
  kind,
  active,
  className,
}: {
  kind: MainLayout;
  active: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-12 w-full flex-col overflow-hidden rounded-[8px] border",
        active ? "border-accent/40 bg-accent/[.06]" : "border-hairline bg-black/20",
        className,
      )}
    >
      {kind === "classic" ? (
        <span className="flex min-h-0 flex-1">
          <span className="m-1.5 mr-0 w-4 shrink-0 rounded-[3px] bg-white/15" />
          <span className="m-1.5 flex min-w-0 flex-1 flex-col gap-1">
            <span className="h-1.5 rounded-[2px] bg-white/25" />
            <span className="min-h-0 flex-1 rounded-[3px] bg-white/[.07]" />
          </span>
        </span>
      ) : (
        <span className="flex min-h-0 flex-1">
          <span className="m-1.5 mr-1 flex w-2 shrink-0 flex-col gap-1">
            <span className="h-1.5 rounded-[2px] bg-white/25" />
            <span className="min-h-0 flex-1 rounded-[3px] bg-white/15" />
          </span>
          <span className="mt-1.5 flex min-w-0 flex-1 flex-col gap-1 pr-1.5">
            <span className="h-1.5 rounded-[2px] bg-white/25" />
            <span className="min-h-0 flex-1 rounded-[3px] bg-white/[.07]" />
          </span>
        </span>
      )}
    </span>
  );
}
