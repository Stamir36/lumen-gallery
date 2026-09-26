import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FolderSearch, HardDrive, RefreshCw, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Segmented } from "@/components/ui/Segmented";
import { formatBytes, formatCount } from "@/lib/api";
import { baseName } from "@/lib/format";
import { enqueueThumbs, thumbSrc, useThumbStore } from "@/lib/thumbs";
import { tauriAvailable } from "@/lib/assets";
import { deleteForever } from "@/lib/mediaActions";
import { toast } from "sonner";

/**
 * Disk space tool — "where did my drive go".
 *
 * A view over `disk_usage` (src-tauri/src/disk.rs): the heaviest files, the
 * same bytes bucketed by extension, and per-library totals. Read-only; the
 * only action it offers is "open the folder" — deleting lives in the library,
 * where context menus and the recycle bin already work.
 */

interface DiskItem {
  id: number;
  path: string;
  kind: string;
  ext: string;
  size: number;
  mtime: number;
  width: number | null;
  height: number | null;
  thumbPath: string | null;
}

interface ExtUsage {
  ext: string;
  kind: string;
  totalBytes: number;
  fileCount: number;
}

interface RootUsage {
  rootId: number;
  path: string;
  label: string;
  totalBytes: number;
  fileCount: number;
}

interface DiskReport {
  topFiles: DiskItem[];
  byExtension: ExtUsage[];
  byRoot: RootUsage[];
  totalBytes: number;
  fileCount: number;
}

/** How many heavy files the list shows (matches the backend default). */
const TOP_N = 30;

function shortDir(path: string) {
  const cut = path.split(/[\\/]/);
  cut.pop();
  const dir = cut.join("\\");
  return dir.length > 44 ? `…${dir.slice(-43)}` : dir;
}

export default function DiskSpacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<"files" | "types" | "drives">("files");

  const report = useQuery({
    queryKey: ["disk-usage"],
    queryFn: () => invoke<DiskReport>("disk_usage", { topN: TOP_N }),
    // one SQL pass; a result is trusted until the user asks again (the
    // duplicates page set this precedent for heavy reads)
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const groups = report.data;
  const thumbs = useThumbStore((s) => s.thumbs);
  const asked = useRef<Set<number>>(new Set());
  /** file id armed for deletion — the second click on the trash is the go */
  const [armedId, setArmedId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // lazy thumbs for the heaviest-files list, same contract as the finder
  useEffect(() => {
    if (!tauriAvailable() || view !== "files" || !groups) return;
    const missing: number[] = [];
    for (const item of groups.topFiles) {
      if (asked.current.has(item.id)) continue;
      asked.current.add(item.id);
      const known = thumbs[item.id];
      if (!item.thumbPath && !(known && known.status === "ok")) missing.push(item.id);
    }
    if (missing.length > 0) enqueueThumbs(missing);
  }, [view, groups, thumbs]);

  const maxFile = groups?.topFiles[0]?.size ?? 0;
  const maxExt = groups?.byExtension[0]?.totalBytes ?? 0;
  const maxRoot = groups?.byRoot[0]?.totalBytes ?? 0;
  const topShare = useMemo(() => {
    if (!groups || groups.totalBytes === 0) return 0;
    return Math.round(
      (groups.topFiles.reduce((s, f) => s + f.size, 0) / groups.totalBytes) * 100,
    );
  }, [groups]);

  const scanning = report.isFetching;

  /** Recycle-bin deletion through the existing library path; row + entry go
      away, the list refetches and the bars recompute themselves. */
  async function recycleItem(item: DiskItem) {
    setDeleting(true);
    try {
      await deleteForever([{ id: item.id, path: item.path }]);
      setArmedId(null);
      await report.refetch();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* header: back + title + range switch + rescan (mirrors the finder) */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <IconButton label={t("actions.back")} onClick={() => navigate("/tools")}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label flex-1">{t("disk.title")}</span>
        <Segmented
          aria-label={t("disk.view")}
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: "files", label: t("disk.view_files") },
            { value: "types", label: t("disk.view_types") },
            { value: "drives", label: t("disk.view_drives") },
          ]}
        />
        <IconButton
          label={t("disk.rescan")}
          onClick={() => void report.refetch()}
          className={cn(scanning && "text-accent")}
        >
          <RefreshCw size={18} className={cn(scanning && "animate-spin")} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
        {/* summary strip: three figures, hairline-separated (editorial) */}
        {groups && (
          <div className="mb-8 flex flex-wrap items-end gap-x-10 gap-y-3 border-b border-hairline pb-6">
            <div>
              <div className="micro-label mb-1.5">{t("disk.total")}</div>
              <div className="text-3xl font-[650] tabular-nums tracking-[-0.02em] text-tprimary">
                {formatBytes(groups.totalBytes)}
              </div>
            </div>
            <div>
              <div className="micro-label mb-1.5">{t("disk.files")}</div>
              <div className="text-3xl font-[650] tabular-nums tracking-[-0.02em] text-tsecondary">
                {formatCount(groups.fileCount)}
              </div>
            </div>
            {view === "files" && (
              <div className="ml-auto font-mono text-[11px] tabular-nums text-ttertiary">
                {t("disk.top_share", { count: TOP_N, percent: topShare })}
              </div>
            )}
          </div>
        )}

        {report.isPending && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <HardDrive size={28} strokeWidth={1.5} className="text-ttertiary" />
            <p className="text-sm text-tsecondary">{t("disk.loading")}</p>
          </div>
        )}

        {report.isError && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="text-sm text-tsecondary">{t("disk.failed")}</p>
            <button
              type="button"
              onClick={() => void report.refetch()}
              className="rounded-pill bg-surface-2 px-4 py-2 text-[13px] text-tprimary transition-colors hover:bg-surface-3"
            >
              {t("disk.rescan")}
            </button>
          </div>
        )}

        {/* ——— heaviest files ——— */}
        {groups && view === "files" && (
          <div className="flex flex-col">
            {groups.topFiles.map((item, i) => {
              const known = thumbs[item.id];
              const rawPath =
                known && known.status === "ok" ? (known.path ?? null) : item.thumbPath;
              return (
                <div
                  key={item.id}
                  className="group flex items-center gap-4 border-b border-hairline py-3 pr-2 transition-colors last:border-b-0 hover:bg-surface-2/60"
                >
                  <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-ttertiary">
                    {i + 1}
                  </span>
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-surface-2">
                    {rawPath ? (
                      <img
                        src={thumbSrc(rawPath)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full select-none object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-[9px] uppercase text-ttertiary">
                        {item.ext}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className="truncate text-[14px] text-tprimary" title={item.path}>
                        {baseName(item.path)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-tsecondary">
                        {formatBytes(item.size)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-[3px] w-full overflow-hidden rounded-pill bg-surface-2"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-pill bg-accent/70"
                        style={{ width: `${maxFile > 0 ? Math.max(2, (item.size / maxFile) * 100) : 0}%` }}
                      />
                    </div>
                    <span
                      className="mt-1 block truncate font-mono text-[10px] text-ttertiary"
                      title={item.path}
                    >
                      {shortDir(item.path)}
                    </span>
                  </div>
                  {/* two-step delete: the first click arms, the second sends
                      to the recycle bin (never an unlink) */}
                  <div className="flex shrink-0 items-center gap-1">
                    {armedId === item.id ? (
                      <>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => void recycleItem(item)}
                          className="flex items-center gap-1.5 rounded-pill bg-danger/15 px-3 py-1.5 text-[12px] text-danger transition-colors hover:bg-danger/25 disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                          {t("disk.delete_confirm")}
                        </button>
                        <IconButton
                          label={t("disk.delete_cancel")}
                          onClick={() => setArmedId(null)}
                          className="h-8 w-8"
                        >
                          <X size={14} />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          label={t("disk.delete_arm", { size: formatBytes(item.size) })}
                          disabled={deleting}
                          onClick={() => setArmedId(item.id)}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 size={16} />
                        </IconButton>
                        <IconButton
                          label={t("disk.reveal")}
                          onClick={() =>
                            void invoke("reveal_path", { path: item.path }).catch(() => undefined)
                          }
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <FolderSearch size={16} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ——— by extension ——— */}
        {groups && view === "types" && (
          <div className="flex flex-col gap-5">
            {groups.byExtension.map((ext) => (
              <div key={ext.ext}>
                <div className="mb-2 flex items-baseline justify-between gap-4">
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] uppercase text-tprimary">
                      .{ext.ext}
                    </span>
                    <span className="text-[12px] text-ttertiary">
                      {t("disk.ext_files", { count: ext.fileCount })}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-tsecondary">
                    {formatBytes(ext.totalBytes)}
                  </span>
                </div>
                <div className="h-[6px] w-full overflow-hidden rounded-pill bg-surface-2">
                  <div
                    className="h-full rounded-pill bg-accent/70"
                    style={{
                      width: `${maxExt > 0 ? Math.max(1.5, (ext.totalBytes / maxExt) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ——— per library ——— */}
        {groups && view === "drives" && (
          <div className="flex flex-col gap-6">
            {groups.byRoot.map((root) => (
              <div
                key={root.rootId}
                className="rounded-card border border-hairline bg-surface-2/40 p-5"
              >
                <div className="mb-3 flex items-baseline justify-between gap-4">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <HardDrive size={15} className="shrink-0 text-tsecondary" />
                    <span className="truncate text-[14px] font-[600] text-tprimary">
                      {root.label || root.path}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-tsecondary">
                    {formatBytes(root.totalBytes)}
                  </span>
                </div>
                <div className="h-[6px] w-full overflow-hidden rounded-pill bg-surface-3">
                  <div
                    className="h-full rounded-pill bg-accent/70"
                    style={{
                      width: `${maxRoot > 0 ? Math.max(1.5, (root.totalBytes / maxRoot) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="truncate font-mono text-[10px] text-ttertiary" title={root.path}>
                    {root.path}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-ttertiary">
                    {t("disk.ext_files", { count: root.fileCount })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
