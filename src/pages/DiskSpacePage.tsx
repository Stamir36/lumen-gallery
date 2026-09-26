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
 * only write it performs is the existing recycle-bin path (arm → confirm).
 *
 * DESIGN pass: same language as the duplicates finder — the total is the page
 * headline in the hero slot, every list lives in a tonal elev-1 card, progress
 * bars are the shared accent gradient, and a row armed for deletion wears a
 * ring instead of turning into a red box.
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

/** The shared bar: 5px track, accent gradient fill, min 1.5% so it is visible. */
function Bar({ ratio, className }: { ratio: number; className?: string }) {
  return (
    <div className={cn("h-[5px] w-full overflow-hidden rounded-pill bg-surface-1", className)}>
      <div
        className="h-full rounded-pill bg-gradient-to-r from-accent/60 to-accent"
        style={{ width: `${Math.max(1.5, Math.min(100, ratio * 100))}%` }}
      />
    </div>
  );
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
        <IconButton label={t("actions.back")} onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label">{t("disk.title")}</span>
        <Segmented
          aria-label={t("disk.view")}
          size="sm"
          tone="quiet"
          className="ml-2"
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: "files", label: t("disk.view_files") },
            { value: "types", label: t("disk.view_types") },
            { value: "drives", label: t("disk.view_drives") },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            label={t("disk.rescan")}
            onClick={() => void report.refetch()}
            className={cn(scanning && "text-accent")}
          >
            <RefreshCw size={18} className={cn(scanning && "animate-spin")} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* hero summary: the total is the headline, the file count sits beside
            it as a mono figure, the top-30 note closes the right edge */}
        {groups && (
          <div className="px-6 pb-4 pt-7">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <div className="micro-label mb-1.5">{t("disk.total")}</div>
                <div className="font-mono text-[34px] font-medium leading-none text-tprimary">
                  {formatBytes(groups.totalBytes)}
                </div>
              </div>
              <div className="flex gap-8 pb-0.5">
                <div>
                  <div className="font-mono text-lg leading-tight text-tsecondary">
                    {formatCount(groups.fileCount)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ttertiary">{t("disk.files")}</div>
                </div>
              </div>
              {view === "files" && (
                <div className="ml-auto max-w-[30ch] pb-1 text-right font-mono text-[11px] leading-relaxed text-ttertiary">
                  {t("disk.top_share", { count: TOP_N, percent: topShare })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* the scan is one SQL pass with no progress events, so the bar is the
            indeterminate kind — same slot and shape as the finder's */}
        {scanning && (
          <div className="px-6 pb-5">
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-tsecondary">
                {t("disk.loading")}
              </span>
            </div>
            <div className="h-[5px] w-full overflow-hidden rounded-pill bg-surface-2">
              <div className="h-full w-full animate-pulse rounded-pill bg-accent/50" />
            </div>
          </div>
        )}

        {report.isPending && !scanning && (
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
          <div className="px-6 pb-8">
            <div className="rounded-card bg-surface-2 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.35)]">
              {groups.topFiles.map((item, i) => {
                const known = thumbs[item.id];
                const rawPath =
                  known && known.status === "ok" ? (known.path ?? null) : item.thumbPath;
                const isArmed = armedId === item.id;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group flex items-center gap-4 rounded-control px-3 py-3 transition-colors duration-[160ms]",
                      // armed = ring + tint (same language as the finder's keep
                      // state), so the row does not jump into a red box
                      isArmed
                        ? "bg-danger/[.08] ring-1 ring-danger/45"
                        : "hover:bg-surface-3/60",
                    )}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-ttertiary">
                      {i + 1}
                    </span>
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-surface-1">
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
                      <Bar
                        ratio={maxFile > 0 ? item.size / maxFile : 0}
                        className="mt-1.5 bg-surface-1 transition-colors duration-[160ms] group-hover:bg-surface-1/60"
                      />
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
                      {isArmed ? (
                        <>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => void recycleItem(item)}
                            className="flex items-center gap-1.5 rounded-pill bg-danger px-3.5 py-1.5 text-[12px] text-white transition-colors hover:bg-danger/85 disabled:opacity-50"
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
                            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 size={16} />
                          </IconButton>
                          <IconButton
                            label={t("disk.reveal")}
                            onClick={() =>
                              void invoke("reveal_path", { path: item.path }).catch(() => undefined)
                            }
                            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
          </div>
        )}

        {/* ——— by extension ——— */}
        {groups && view === "types" && (
          <div className="px-6 pb-8">
            <div className="rounded-card bg-surface-2 px-6 py-5 shadow-[0_8px_24px_rgba(0,0,0,.35)]">
              {groups.byExtension.map((ext, i) => (
                <div
                  key={ext.ext}
                  className={cn("py-3", i > 0 && "border-t border-hairline")}
                >
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
                  <Bar ratio={maxExt > 0 ? ext.totalBytes / maxExt : 0} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ——— per library ——— */}
        {groups && view === "drives" && (
          <div className="flex flex-col gap-4 px-6 pb-8">
            {groups.byRoot.map((root) => (
              <div
                key={root.rootId}
                className="rounded-card bg-surface-2 p-5 shadow-[0_8px_24px_rgba(0,0,0,.35)]"
              >
                <div className="mb-3 flex items-baseline justify-between gap-4">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <HardDrive size={15} className="shrink-0 text-tsecondary" />
                    <span className="truncate text-[15px] font-[600] text-tprimary">
                      {root.label || root.path}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[13px] tabular-nums text-tprimary">
                    {formatBytes(root.totalBytes)}
                  </span>
                </div>
                <Bar ratio={maxRoot > 0 ? root.totalBytes / maxRoot : 0} />
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
