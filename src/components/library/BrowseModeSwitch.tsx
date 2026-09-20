import { useTranslation } from "react-i18next";
import { FolderTree, Images, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryUi } from "@/state/library-ui";

/**
 * ONE browse switch (F12): the user was confused by a gallery/explorer toggle
 * PLUS a tree/cards toggle — three pills of mode icons in the titlebar. Now a
 * single 3-segment control chooses the whole experience:
 *
 *   [ Галерея ] [ Проводник · дерево ] [ Проводник · карточки ]
 *
 * Segments 2–3 set `browse: "explorer"` AND the explorer layout in one tap, so
 * the layout switcher is gone from the UI entirely.
 */
export function BrowseModeSwitch() {
  const { t } = useTranslation();
  const browse = useLibraryUi((s) => s.browse);
  const setBrowse = useLibraryUi((s) => s.setBrowse);
  const explorerLayout = useLibraryUi((s) => s.explorerLayout);
  const setExplorerLayout = useLibraryUi((s) => s.setExplorerLayout);

  type Seg = {
    id: string;
    icon: React.ReactNode;
    label: string;
    active: boolean;
    onPick: () => void;
  };

  const segments: Seg[] = [
    {
      id: "gallery",
      icon: <Images size={17} />,
      label: t("browse.gallery"),
      active: browse === "gallery",
      onPick: () => setBrowse("gallery"),
    },
    {
      id: "tree",
      icon: <FolderTree size={17} />,
      label: t("browse.explorer_tree"),
      active: browse === "explorer" && explorerLayout === "tree",
      onPick: () => {
        setExplorerLayout("tree");
        setBrowse("explorer");
      },
    },
    {
      id: "cards",
      icon: <LayoutGrid size={17} />,
      label: t("browse.explorer_cards"),
      active: browse === "explorer" && explorerLayout === "grid",
      onPick: () => {
        setExplorerLayout("grid");
        setBrowse("explorer");
      },
    },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("browse.mode")}
      className="flex h-9 items-center gap-0.5 rounded-pill bg-surface-2 p-0.5"
    >
      {segments.map((seg) => (
        <button
          key={seg.id}
          type="button"
          role="tab"
          aria-selected={seg.active}
          aria-label={seg.label}
          title={seg.label}
          onClick={seg.onPick}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-pill",
            "transition-colors duration-[160ms] ease-out active:scale-[.97]",
            seg.active
              ? "bg-surface-3 text-tprimary shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
              : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
          )}
        >
          {seg.icon}
        </button>
      ))}
    </div>
  );
}
