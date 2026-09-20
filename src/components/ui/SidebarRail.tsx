import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { NavTooltip } from "./NavTooltip";

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  /** optional capacity bar: 0..1 + mono caption */
  capacity?: { ratio: number; caption: string };
  active?: boolean;
  onSelect?: () => void;
  /** optional trailing action (e.g. rescan a root) */
  action?: { label: string; icon: ReactNode; onClick: () => void };
}

/**
 * Sidebar v2 (DESIGN.md v2 §10): 260px / 68px rail, matte glass,
 * rows 44-48, capacity bar 6px accent, tonal active state (no hairlines).
 */
export function SidebarRail({
  items,
  bottom,
  railBottom,
  className,
}: {
  items: SidebarItem[];
  bottom?: ReactNode;
  /** icons-only footer for the collapsed rail */
  railBottom?: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const wide = !collapsed;
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className={cn(
          // solid surface-1 + right hairline (v2.2 chrome, no blur)
          "flex h-full flex-col overflow-hidden border-r border-hairline bg-surface-1 transition-[width] duration-[160ms] ease-out",
          wide ? "w-[260px]" : "w-16",
          className,
        )}
      >
        <div className="flex h-16 shrink-0 items-center px-4">
          {wide ? (
            <>
              <span className="micro-label flex-1 pl-2">{t("sidebar.library")}</span>
              <IconButton
                label={t("sidebar.collapse")}
                onClick={() => setCollapsed(true)}
              >
                <PanelLeftClose size={16} />
              </IconButton>
            </>
          ) : (
            <IconButton
              label={t("sidebar.expand")}
              className="mx-auto"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen size={16} />
            </IconButton>
          )}
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-3 p-4",
            wide ? "overflow-y-auto" : "overflow-y-hidden",
          )}
        >
          {items.map((item) => (
            <SidebarRow key={item.id} item={item} wide={wide} />
          ))}
        </div>

        {wide ? (
          bottom && <div className="shrink-0 overflow-hidden p-4">{bottom}</div>
        ) : (
          railBottom && (
            <div className="flex shrink-0 flex-col items-center gap-1 p-2">
              {railBottom}
            </div>
          )
        )}
      </nav>
    </TooltipProvider>
  );
}

function SidebarRow({ item, wide }: { item: SidebarItem; wide: boolean }) {
  const row = (
    <button
      onClick={item.onSelect}
      className={cn(
        "group flex h-11 w-full items-center gap-3 rounded-control px-3 text-left transition-all duration-[160ms] ease-out",
        item.active
          ? // accent anchor: 14% tinted glass + accent icon + accent counter
            "bg-accent/[.14] text-tprimary shadow-[inset_0_1px_0_var(--accent-soft)] [&_svg]:text-accent"
          : // unified hover language: tonal fill + faint accent glow (§2/§11)
            "text-tsecondary hover:bg-white/[.06] hover:text-tprimary hover:shadow-[0_0_0_1px_var(--accent-soft)]",
        !wide && "justify-center px-0",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:size-5">
        {item.icon}
      </span>
      {wide && (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {item.label}
          </span>
          {item.badge && (
            <span
              className={cn(
                "font-mono text-[11px]",
                item.active ? "text-accent" : "text-ttertiary",
              )}
            >
              {item.badge}
            </span>
          )}
          {item.action && (
            <span
              role="button"
              tabIndex={0}
              aria-label={item.action.label}
              title={item.action.label}
              onClick={(e) => {
                e.stopPropagation();
                item.action?.onClick();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  item.action?.onClick();
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-[10px] text-ttertiary opacity-0 transition-all duration-[160ms] hover:bg-surface-3 hover:text-tprimary group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-4"
            >
              {item.action.icon}
            </span>
          )}
        </>
      )}
    </button>
  );

  return (
    <div>
      {wide ? (
        row
      ) : (
        <NavTooltip label={item.label} caption={item.capacity?.caption}>
          {row}
        </NavTooltip>
      )}
      {wide && item.capacity && (
        <div className="mb-1 mt-1.5 px-3">
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-gradient-to-r from-accent/60 to-accent"
              style={{ width: `${Math.round(item.capacity.ratio * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-ttertiary">
            {item.capacity.caption}
          </div>
        </div>
      )}
    </div>
  );
}
