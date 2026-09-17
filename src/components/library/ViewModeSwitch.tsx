import { useTranslation } from "react-i18next";
import { Columns3, LayoutGrid, List, SquareStack } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryUi, type ViewMode } from "@/state/library-ui";

/**
 * Compact icon-only view switcher (v2.2): lives in the WINDOW title bar, right
 * of the drag spacer and left of the window controls, so the library bar below
 * stays a single row. Icon-only + tooltips, never labeled chips.
 */
export function ViewModeSwitch() {
  const { t } = useTranslation();
  const view = useLibraryUi((s) => s.view);
  const setView = useLibraryUi((s) => s.setView);

  const options: { value: ViewMode; key: string; icon: React.ReactNode }[] = [
    { value: "justified", key: "topbar.view_justified", icon: <LayoutGrid size={17} /> },
    { value: "masonry", key: "topbar.view_masonry", icon: <Columns3 size={17} /> },
    { value: "square", key: "topbar.view_square", icon: <SquareStack size={17} /> },
    { value: "list", key: "topbar.view_list", icon: <List size={17} /> },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("topbar.view_mode")}
      className="flex h-9 items-center gap-0.5 rounded-pill bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = view === o.value;
        const label = t(o.key);
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => setView(o.value)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-pill",
              "transition-colors duration-[160ms] ease-out active:scale-[.97]",
              // active = tonal lift, NOT accent: accent anchors are reserved
              active
                ? "bg-surface-3 text-tprimary shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
                : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
            )}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}
