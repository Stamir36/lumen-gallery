import { useTranslation } from "react-i18next";
import { FolderTree, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryUi, type ExplorerLayout } from "@/state/library-ui";

/**
 * Explorer sub-layout switch (S1.9): TREE = folder tree on the left + the open
 * folder's contents; GRID = no tree, subfolder cards above the contents. The two
 * never coexist — the same directories used to be listed twice.
 *
 * Compact, icon-only, same visual language as the title-bar view switcher; it
 * lives in the library bar, i.e. the explorer's own header, and only there.
 */
export function ExplorerLayoutSwitch() {
  const { t } = useTranslation();
  const layout = useLibraryUi((s) => s.explorerLayout);
  const setLayout = useLibraryUi((s) => s.setExplorerLayout);

  const options: { value: ExplorerLayout; key: string; icon: React.ReactNode }[] = [
    { value: "tree", key: "explorer.layout_tree", icon: <FolderTree size={16} /> },
    { value: "grid", key: "explorer.layout_grid", icon: <LayoutGrid size={16} /> },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("explorer.layout")}
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-pill bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = layout === o.value;
        const label = t(o.key);
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => setLayout(o.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-pill",
              "transition-colors duration-[160ms] ease-out active:scale-[.97]",
              // active = tonal lift, not accent (accent anchors stay reserved)
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
