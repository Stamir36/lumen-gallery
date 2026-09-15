import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

/**
 * Menu v2 (DESIGN.md v2 §10): matte frosted glass, elev-3,
 * radius-control, items 40px, hover surface-2.
 */
export const MenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "glass z-50 min-w-52 rounded-control p-2",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_12px_32px_rgba(0,0,0,.55)]",
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
      "flex h-10 cursor-default select-none items-center gap-3 rounded-control px-3.5 text-sm text-tsecondary outline-none",
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
    className={cn("my-2 h-px border-t border-hairline", className)}
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
    className={cn("micro-label px-3.5 py-2", className)}
    {...props}
  />
));
MenuLabel.displayName = "MenuLabel";
