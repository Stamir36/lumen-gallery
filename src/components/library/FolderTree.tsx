import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Folder, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, type FolderRow } from "@/lib/api";
import { useFolders } from "@/lib/queries";
import { useLibraryUi } from "@/state/library-ui";

/**
 * File-manager tree (explorer mode): one library root, lazily expanded.
 * Children come from the same `list_folders` query the shelf uses — counts are
 * recursive for the subtree, so a node reads like "3 412" without opening it.
 * Only expanded nodes are fetched, so a deep tree costs nothing until used.
 */
export function FolderTree({
  rootId,
  rootPath,
  rootLabel,
  className,
}: {
  rootId: number;
  rootPath: string;
  rootLabel: string;
  className?: string;
}) {
  const current = useLibraryUi((s) => (s.route.kind === "root" ? s.route.dir : null));
  const openFolder = useLibraryUi((s) => s.openFolder);
  const [open, setOpen] = useState<Set<string>>(() => new Set([rootPath]));

  // the tree always reveals the folder that the contents pane is showing
  useEffect(() => {
    if (!current) return;
    const sep = current.includes("\\") ? "\\" : "/";
    const parts = current.split(sep);
    setOpen((prev) => {
      const next = new Set(prev);
      let acc = parts[0] ?? "";
      if (acc) next.add(acc);
      for (const part of parts.slice(1)) {
        acc = acc ? `${acc}${sep}${part}` : part;
        next.add(acc);
      }
      return next;
    });
  }, [current]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className={cn("min-h-0 overflow-x-hidden overflow-y-auto py-3", className)}>
      <TreeRow
        label={rootLabel}
        icon={<HardDrive size={15} />}
        depth={0}
        expanded={open.has(rootPath)}
        active={current === null}
        onToggle={() => toggle(rootPath)}
        onOpen={() => openFolder(null)}
      />
      {open.has(rootPath) && (
        <TreeLevel
          rootId={rootId}
          dir={rootPath}
          depth={1}
          open={open}
          toggle={toggle}
          current={current}
          openFolder={openFolder}
        />
      )}
    </div>
  );
}

function TreeLevel({
  rootId,
  dir,
  depth,
  open,
  toggle,
  current,
  openFolder,
}: {
  rootId: number;
  dir: string;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  current: string | null;
  openFolder: (dir: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data, error } = useFolders(rootId, dir, true);

  useEffect(() => {
    if (error) console.error("list_folders failed:", error);
  }, [error]);

  // first paint of a non-empty node must not flash an empty state
  if (!data) return null;

  if (data.length === 0) {
    return (
      <p
        className="py-1 pr-3 font-mono text-[10px] uppercase tracking-[0.08em] text-ttertiary"
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {t("explorer.no_subfolders")}
      </p>
    );
  }

  return (
    <>
      {data.map((folder: FolderRow) => (
        <div key={folder.path}>
          <TreeRow
            label={folder.name}
            icon={<Folder size={15} />}
            depth={depth}
            count={folder.count}
            expanded={open.has(folder.path)}
            active={current === folder.path}
            onToggle={() => toggle(folder.path)}
            onOpen={() => openFolder(folder.path)}
          />
          {open.has(folder.path) && (
            <TreeLevel
              rootId={rootId}
              dir={folder.path}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              current={current}
              openFolder={openFolder}
            />
          )}
        </div>
      ))}
    </>
  );
}

function TreeRow({
  label,
  icon,
  depth,
  count,
  expanded,
  active,
  onToggle,
  onOpen,
}: {
  label: string;
  icon: React.ReactNode;
  depth: number;
  count?: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group flex h-8 items-center gap-0.5 rounded-[10px] pr-2 transition-colors duration-[160ms]",
        active
          ? "bg-accent/[.14] text-tprimary [&_svg]:text-accent"
          : "text-tsecondary hover:bg-white/[.06] hover:text-tprimary",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <button
        type="button"
        aria-label={expanded ? t("explorer.collapse") : t("explorer.expand")}
        title={expanded ? t("explorer.collapse") : t("explorer.expand")}
        onClick={onToggle}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-ttertiary transition-colors hover:text-tprimary"
      >
        <ChevronRight
          size={14}
          className={cn("transition-transform duration-[160ms] ease-out", expanded && "rotate-90")}
        />
      </button>
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
      >
        <span className="shrink-0 [&_svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-ttertiary">
            {formatCount(count)}
          </span>
        )}
      </button>
    </div>
  );
}
