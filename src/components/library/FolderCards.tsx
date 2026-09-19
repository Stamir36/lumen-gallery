import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clipboard, Eye, Folder, FolderOpen, FolderX } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type FolderRow } from "@/lib/api";
import { tauriAvailable } from "@/lib/assets";
import { enqueueThumbs, thumbSrc, useThumbStore } from "@/lib/thumbs";
import { useFolders } from "@/lib/queries";
import { useContextMenu } from "@/state/contextMenu";
import { useLibraryUi } from "@/state/library-ui";

/**
 * Explorer › GRID layout (S1.9): the subfolders of the open folder as WRAPPING
 * cards above its contents — cover = first cached thumb, else dominant color,
 * else a tonal tile. No tree is rendered in this layout: either the tree or the
 * cards, never both.
 *
 * The strip scrolls on its own (capped height) so a folder with 60 subfolders
 * cannot push the media grid out of the window, and it uses the v2.2 gutter
 * (px-9 = 36px) so the card grid lines up with the media grid below it.
 */
export function FolderGrid({
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
    <div className="max-h-[38vh] shrink-0 overflow-y-auto border-b border-hairline">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 px-9 py-4">
        {data.map((folder) => (
          <FolderCard
            key={folder.path}
            rootId={rootId}
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
  rootId,
  folder,
  onOpen,
  countLabel,
}: {
  rootId: number;
  folder: FolderRow;
  onOpen: () => void;
  countLabel: string;
}) {
  // right-click menu (FIX 8): same actions as the kebab, one gesture away
  const { t } = useTranslation();
  const openMenu = useContextMenu((s) => s.openMenu);
  const qc = useQueryClient();

  /** hide the whole subtree from the library and from the next scan (FIX 5) */
  const exclude = () => {
    void api
      .excludeFolder(rootId, folder.path)
      .then(async () => {
        toast.success(t("menu.folder_excluded", { name: folder.name }));
        await qc.invalidateQueries();
      })
      .catch((err) => {
        console.error("exclude folder failed", err);
        toast.error(String(err));
      });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({
      x: e.clientX,
      y: e.clientY,
      title: folder.name,
      mono: `${countLabel} · ${folder.path}`,
      sections: [
        {
          id: "folder",
          items: [
            {
              id: "open",
              label: t("menu.folder_open"),
              icon: <Eye size={15} />,
              onSelect: onOpen,
            },
            {
              id: "explorer",
              label: t("menu.folder_explorer"),
              icon: <FolderOpen size={15} />,
              disabled: !tauriAvailable(),
              onSelect: () => {
                // same bug as the media card: "show in Explorer" must not be
                // routed through the external player (open_external)
                void invoke("reveal_path", { path: folder.path }).catch((err) =>
                  toast.error(String(err)),
                );
              },
            },
            {
              id: "copy",
              label: t("menu.copy_path"),
              icon: <Clipboard size={15} />,
              onSelect: () => {
                void navigator.clipboard
                  .writeText(folder.path)
                  .then(() => toast.success(t("menu.copied")))
                  .catch(() => toast.error(t("menu.copy_failed")));
              },
            },
          ],
        },
        {
          id: "danger",
          items: [
            {
              id: "exclude",
              label: t("menu.folder_exclude"),
              icon: <FolderX size={15} />,
              danger: true,
              onSelect: exclude,
            },
          ],
        },
      ],
    });
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      aria-label={folder.name}
      className={cn(
        "hover-lift group w-full min-w-0 rounded-card bg-surface-1 p-2.5 text-left",
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
  // EVERY thumb path goes through thumbSrc (convertFileSrc) — a raw DB path in
  // src= floods DevTools with "Not allowed to load local resource: file:///..."
  const rawPath = state?.path ?? folder.coverThumb ?? null;
  const src = rawPath ? thumbSrc(rawPath) : null;
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
