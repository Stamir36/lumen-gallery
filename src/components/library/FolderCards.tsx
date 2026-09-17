import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FolderRow } from "@/lib/api";
import { enqueueThumbs, useThumbStore } from "@/lib/thumbs";
import { useFolders } from "@/lib/queries";
import { useLibraryUi } from "@/state/library-ui";

/**
 * Root/folder navigation (STEP 3B): a horizontally scrolling shelf of folder
 * cards — cover = first cached thumb, else dominant color, else a tonal tile.
 */
export function FolderShelf({
  rootId,
  dir,
  enabled,
}: {
  rootId: number;
  dir: string | null;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const openFolder = useLibraryUi((s) => s.openFolder);
  const { data, error } = useFolders(rootId, dir, enabled);

  useEffect(() => {
    if (error) console.error("list_folders failed:", error);
  }, [error]);

  if (!data || data.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-hairline">
      <div className="flex gap-3 overflow-x-auto overflow-y-hidden px-9 py-4">
        {data.map((folder) => (
          <FolderCard
            key={folder.path}
            folder={folder}
            onOpen={() => openFolder(folder.path)}
            countLabel={t("counts.media", { count: folder.count })}
          />
        ))}
      </div>
    </div>
  );
}

function FolderCard({
  folder,
  onOpen,
  countLabel,
}: {
  folder: FolderRow;
  onOpen: () => void;
  countLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={folder.name}
      className={cn(
        "hover-lift group w-[196px] shrink-0 rounded-card bg-surface-1 p-2.5 text-left",
      )}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[14px]">
        <FolderCover folder={folder} />
      </div>
      <div className="mt-2.5 flex items-center gap-2 px-1 pb-0.5">
        <Folder size={15} className="shrink-0 text-ttertiary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-tprimary">
          {folder.name}
        </span>
      </div>
      <div className="px-1 pb-0.5 font-mono text-[11px] text-ttertiary">{countLabel}</div>
    </button>
  );
}

function FolderCover({ folder }: { folder: FolderRow }) {
  // hooks are unconditional: -1 simply never has a cached thumb
  const state = useThumbStore((s) => s.thumbs[folder.coverId ?? -1]);
  const src = state?.path ?? folder.coverThumb ?? null;
  const color = state?.color ?? folder.coverColor ?? null;
  /** the cover candidate may itself fail: fall through to a plain surface */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => setFailedSrc(null), [src]);

  useEffect(() => {
    // covers are lazy too: only shelves on screen ask for a thumbnail
    if (folder.coverId != null && !folder.coverThumb) {
      enqueueThumbs([folder.coverId]);
    }
  }, [folder.coverId, folder.coverThumb]);

  const imgSrc = src && src !== failedSrc ? src : null;

  return (
    <div
      className="h-full w-full bg-surface-2 transition-transform duration-[160ms] ease-out group-hover:scale-[1.03]"
      style={color ? { backgroundColor: color } : undefined}
    >
      {/* cover chain ends in a tonal surface + folder glyph — never a broken
          image icon; shimmer only while a thumb may still arrive */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className={cn("h-full w-full object-cover", !state && !folder.coverThumb && "opacity-0")}
        />
      ) : color ? (
        <div className="h-full w-full" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-2 text-ttertiary">
          <Folder size={22} strokeWidth={1.5} />
        </div>
      )}
      {!imgSrc && (color || folder.coverId != null) && (
        <div className="shimmer-bg absolute inset-0 opacity-40" />
      )}
    </div>
  );
}
