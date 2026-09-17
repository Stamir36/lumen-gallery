import { useTranslation } from "react-i18next";
import { CornerLeftUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/api";
import { IconButton } from "@/components/ui/IconButton";
import { useLibraryUi } from "@/state/library-ui";

/**
 * Mono breadcrumbs for folder routes (STEP 3B). Every ancestor is clickable,
 * the current folder is inert; alt+← goes up a level (see App key handler).
 */
export function Breadcrumbs({
  rootLabel,
  rootPath,
  dir,
  count,
}: {
  rootLabel: string;
  rootPath: string;
  dir: string | null;
  count: number;
}) {
  const { t } = useTranslation();
  const openFolder = useLibraryUi((s) => s.openFolder);
  const goUp = useLibraryUi((s) => s.goUp);

  const segments: { label: string; path: string }[] = [];
  if (dir) {
    const sep = dir.includes("\\") ? "\\" : "/";
    const rootTrim = rootPath.replace(/[\\/]+$/, "");
    const rest = dir.startsWith(rootTrim) ? dir.slice(rootTrim.length) : dir;
    let acc = rootTrim;
    for (const part of rest.split(/[\\/]/).filter(Boolean)) {
      acc = `${acc}${sep}${part}`;
      segments.push({ label: part, path: acc });
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {dir && (
        <IconButton label={t("actions.up")} onClick={goUp} className="mr-1">
          <CornerLeftUp size={16} />
        </IconButton>
      )}
      <button
        type="button"
        onClick={() => openFolder(null)}
        className={cn(
          "truncate rounded-[10px] px-2 py-1 font-mono text-[12px] tracking-[0.04em] transition-colors duration-[160ms]",
          dir ? "text-tsecondary hover:bg-white/[.06] hover:text-tprimary" : "text-tprimary",
        )}
      >
        {rootLabel}
      </button>
      {segments.map((seg, i) => {
        const last = i === segments.length - 1;
        return (
          <span key={seg.path} className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-[12px] text-ttertiary">/</span>
            <button
              type="button"
              onClick={() => !last && openFolder(seg.path)}
              className={cn(
                "max-w-[220px] truncate rounded-[10px] px-2 py-1 font-mono text-[12px] tracking-[0.04em] transition-colors duration-[160ms]",
                last
                  ? "text-tprimary"
                  : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
              )}
            >
              {seg.label}
            </button>
          </span>
        );
      })}
      <span className="ml-2 shrink-0 font-mono text-[11px] text-ttertiary">
        {formatCount(count)}
      </span>
    </div>
  );
}
