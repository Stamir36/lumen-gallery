import { useTranslation } from "react-i18next";
import { FolderTree, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryUi, type BrowseMode } from "@/state/library-ui";

/**
 * Compact ICON-ONLY Gallery/Explorer switch (FIX 5): lives in the window title
 * bar before the view-mode icons, same visual language (34px tonal segments,
 * tooltips carry the label). Accent is reserved — active = tonal lift.
 */
export function BrowseModeSwitch() {
  const { t } = useTranslation();
  const browse = useLibraryUi((s) => s.browse);
  const setBrowse = useLibraryUi((s) => s.setBrowse);

  const options: { value: BrowseMode; key: string; icon: React.ReactNode }[] = [
    { value: "gallery", key: "browse.gallery", icon: <Images size={17} /> },
    { value: "explorer", key: "browse.explorer", icon: <FolderTree size={17} /> },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("browse.mode")}
      className="flex h-9 items-center gap-0.5 rounded-pill bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = browse === o.value;
        const label = t(o.key);
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => setBrowse(o.value)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-pill",
              "transition-colors duration-[160ms] ease-out active:scale-[.97]",
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
