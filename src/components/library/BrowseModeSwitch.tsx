import { useTranslation } from "react-i18next";
import { FolderTree, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryUi, type BrowseMode } from "@/state/library-ui";

/**
 * Top-level mode switch (v2.2): Галерея = the library as one stream, Проводник =
 * the library as a disk tree. Lives in the window title bar next to the view
 * switcher, because it changes what the whole library area shows.
 */
export function BrowseModeSwitch() {
  const { t } = useTranslation();
  const browse = useLibraryUi((s) => s.browse);
  const setBrowse = useLibraryUi((s) => s.setBrowse);

  const options: { value: BrowseMode; key: string; icon: React.ReactNode }[] = [
    { value: "explorer", key: "browse.explorer", icon: <FolderTree size={17} /> },
    { value: "gallery", key: "browse.gallery", icon: <Images size={17} /> },
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
              "flex h-8 items-center gap-2 rounded-pill px-3 text-[12px] font-medium whitespace-nowrap",
              "transition-colors duration-[160ms] ease-out active:scale-[.97]",
              active
                ? "bg-surface-3 text-tprimary shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
                : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
            )}
          >
            {o.icon}
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
