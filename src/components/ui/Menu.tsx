import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import * as MenuPrimitive from "@radix-ui/react-menu";
import { cn } from "@/lib/utils";

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

/**
 * Menu per DESIGN.md §6.11: surface-1, hairline border, radius-control,
 * popover shadow; items 32px, hover surface-2.
 */
export const MenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-44 rounded-control border border-hairline bg-surface-1 p-1 shadow-popover",
        className,
      )}
      {...props}
    />
  </MenuPrimitive.Portal>
));
MenuContent.displayName = "MenuContent";

export const MenuItem = forwardRef<
  ElementRef<typeof MenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Item
    ref={ref}
    className={cn(
      "flex h-8 cursor-default select-none items-center gap-2.5 rounded-control px-2.5 text-[13px] text-tsecondary outline-none",
      "transition-colors duration-[160ms] ease-out",
      "data-[highlighted]:bg-surface-2 data-[highlighted]:text-tprimary",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className,
    )}
    {...props}
  />
));
MenuItem.displayName = "MenuItem";

export const MenuSeparator = forwardRef<
  ElementRef<typeof MenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px border-t border-hairline", className)}
    {...props}
  />
));
MenuSeparator.displayName = "MenuSeparator";

export const MenuLabel = forwardRef<
  ElementRef<typeof MenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Label
    ref={ref}
    className={cn("micro-label px-2.5 py-1.5", className)}
    {...props}
  />
));
MenuLabel.displayName = "MenuLabel";
