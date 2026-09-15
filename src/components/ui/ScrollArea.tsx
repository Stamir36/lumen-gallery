import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper enforcing DESIGN.md scrollbar styling on scrollable
 * regions (::-webkit-scrollbar rules in index.css apply globally).
 */
export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-h-0 overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  ),
);
ScrollArea.displayName = "ScrollArea";
