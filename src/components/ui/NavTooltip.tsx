import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/** Tooltip used by the collapsed 64px sidebar rail. */
export function NavTooltip({
  children,
  label,
  caption,
}: {
  children: ReactNode;
  label: string;
  caption?: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={8}
          className={cn(
            "glass z-50 rounded-control px-3 py-2",
            "shadow-popover",
          )}
        >
          <div className="text-[13px] font-medium text-tprimary">{label}</div>
          {caption && (
            <div className="mt-0.5 font-mono text-[10px] text-ttertiary">
              {caption}
            </div>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
