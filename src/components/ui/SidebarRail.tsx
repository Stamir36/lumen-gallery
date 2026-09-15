import { useState, type ReactNode } from "react";
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
}

/**
 * Sidebar per DESIGN.md §6.6: 240px, collapsed rail 64px.
 * Items 32px height, icon 16px, hover surface-2, radius-control.
 * Bottom section: settings / scan status.
 */
export function SidebarRail({
  items,
  bottom,
  className,
}: {
  items: SidebarItem[];
  bottom?: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const wide = !collapsed;

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className={cn(
          "flex h-full flex-col border-r border-hairline bg-surface-1 transition-[width] duration-[160ms] ease-out",
          wide ? "w-60" : "w-16",
          className,
        )}
      >
        <div className="flex h-12 shrink-0 items-center border-b border-hairline px-3">
          {wide ? (
            <>
              <span className="micro-label flex-1">Library</span>
              <IconButton
                label="Collapse sidebar"
                onClick={() => setCollapsed(true)}
              >
                <PanelLeftClose size={16} />
              </IconButton>
            </>
          ) : (
            <IconButton
              label="Expand sidebar"
              className="mx-auto"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen size={16} />
            </IconButton>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {items.map((item) => (
            <SidebarRow key={item.id} item={item} wide={wide} />
          ))}
        </div>

        {bottom && (
          <div className="shrink-0 border-t border-hairline p-2">{bottom}</div>
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
        "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left transition-colors duration-[160ms] ease-out hover:bg-surface-2",
        item.active ? "bg-surface-2 text-tprimary" : "text-tsecondary hover:text-tprimary",
        !wide && "justify-center px-0",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:size-4">
        {item.icon}
      </span>
      {wide && (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {item.label}
          </span>
          {item.badge && (
            <span className="font-mono text-[11px] text-ttertiary">
              {item.badge}
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
        <div className="mb-1 mt-1 px-2.5">
          <div className="h-1 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-accent"
              style={{ width: `${Math.round(item.capacity.ratio * 100)}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[10px] text-ttertiary">
            {item.capacity.caption}
          </div>
        </div>
      )}
    </div>
  );
}
