import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/** Tooltip used by the collapsed 64px sidebar rail and the player pill.
 *  Self-contained: Radix Tooltip (v1.2.x) derefs providerContext unguarded
 *  inside Root, so every Tooltip must sit inside a Provider — this component
 *  brings its own (delayDuration 200, matching the sidebar rail contract).
 *  Without it the whole React tree crashes (empty window). */
export function NavTooltip({
  children,
  label,
  caption,
  side = "right",
  mono = false,
}: {
  children: ReactNode;
  label: string;
  caption?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** mono label — for technical/meta controls (DESIGN §2) */
  mono?: boolean;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            className={cn(
              "glass z-50 rounded-control px-3 py-2",
              "shadow-popover",
            )}
          >
            <div
              className={cn(
                "text-[13px] font-medium text-tprimary",
                mono && "font-mono text-[12px]",
              )}
            >
              {label}
            </div>
            {caption && (
              <div className="mt-0.5 font-mono text-[10px] text-ttertiary">
                {caption}
              </div>
            )}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
