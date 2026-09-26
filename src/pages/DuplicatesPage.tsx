import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Copy, FolderSearch, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Segmented } from "@/components/ui/Segmented";
import { formatBytes, formatCount } from "@/lib/api";
import { baseName, formatResolution } from "@/lib/format";
import { enqueueThumbs, thumbSrc, useThumbStore } from "@/lib/thumbs";
import { deleteForever } from "@/lib/mediaActions";
import { tauriAvailable } from "@/lib/assets";

/**
 * Duplicate finder.
 *
 * Everything here is a view over `find_duplicates` (see src-tauri/src/dupes.rs):
 * the Rust side does the three narrowing passes and reports groups, and this
 * page decides what to do about them. The only write it performs is the
 * existing "delete forever" path, which puts files in the OS Recycle Bin and
 * drops their rows — nothing here ever unlinks a file.
 */

interface DupeItem {
  id: number;
  path: string;
  size: number;
  mtime: number;
  width: number | null;
  height: number | null;
  thumbPath: string | null;
}

interface DupeGroup {
  size: number;
  wastedBytes: number;
  /** oldest first — the default "keep" is the first entry */
  items: DupeItem[];
}

interface DupeReport {
  groups: DupeGroup[];
  candidates: number;
  hashed: number;
  minBytes: number;
}

/** Size floors: 4 KB UI sprites are duplicates in the least useful sense. */
const THRESHOLDS = [
  { value: "all", bytes: 0 },
  { value: "1mb", bytes: 1024 * 1024 },
  { value: "10mb", bytes: 10 * 1024 * 1024 },
] as const;

type Threshold = (typeof THRESHOLDS)[number]["value"];

/** Live progress of the hashing scan, emitted from Rust (`dupes-progress`). */
interface ScanProgress {
  stage: "head" | "full";
  done: number;
  total: number;
}

function shortDir(path: string) {
  const cut = path.split(/[\\/]/);
  cut.pop();
  const dir = cut.join("\\");
  // the tail is what tells two copies apart; the drive letters rarely do
  return dir.length > 52 ? `…${dir.slice(-51)}` : dir;
}

export default function DuplicatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [threshold, setThreshold] = useState<Threshold>("1mb");
  /** group index -> the id the user chose to keep */
  const [keep, setKeep] = useState<Record<number, number>>({});
  /** group index armed for removal — the second click is the confirmation */
  const [armed, setArmed] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  /** live scan progress (null = no scan in flight or not in the app) */
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const bytes = THRESHOLDS.find((x) => x.value === threshold)?.bytes ?? 0;

  const report = useQuery({
    queryKey: ["duplicates", threshold],
    queryFn: () =>
      invoke<DupeReport>("find_duplicates", { minBytes: bytes > 0 ? bytes : null }),
    // This one reads real bytes off the disk. The app-wide default refetches on
    // window focus, which would mean re-hashing everything every time the user
    // alt-tabs back — so here a result is trusted until the user asks again.
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const groups = report.data?.groups ?? [];
  const thumbs = useThumbStore((s) => s.thumbs);

  // the scan reports its two stages from the blocking thread; the listener is
  // global and only trusted while a scan is actually fetching (a late event
  // after the report arrived would otherwise freeze the bar at 90%)
  useEffect(() => {
    if (!tauriAvailable()) return;
    const un = listen<ScanProgress>("dupes-progress", (e) => {
      if (report.isFetching) setProgress(e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [report.isFetching]);

  // a finished (or abandoned) fetch clears the bar
  useEffect(() => {
    if (!report.isFetching) setProgress(null);
  }, [report.isFetching]);

  const totalWasted = useMemo(
    () => groups.reduce((sum, g) => sum + g.wastedBytes, 0),
    [groups],
  );
  const totalFiles = useMemo(
    () => groups.reduce((sum, g) => sum + g.items.length, 0),
    [groups],
  );

  /** ids this page has already asked for, so a failed decode cannot loop */
  const asked = useRef<Set<number>>(new Set());

  // Generate the previews the grid would have generated anyway: the finder is
  // usually the first place a file that was never scrolled past is ever seen.
  // Asked once per item per visit — keying this on `thumbs` instead would
  // re-queue every row that failed to decode, on every thumbnail that lands.
  useEffect(() => {
    if (!tauriAvailable() || groups.length === 0) return;
    const missing: number[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (asked.current.has(item.id)) continue;
        asked.current.add(item.id);
        const known = thumbs[item.id];
        if (!item.thumbPath && !(known && known.status === "ok")) missing.push(item.id);
      }
    }
    if (missing.length > 0) enqueueThumbs(missing);
  }, [groups, thumbs]);

  const keptIdOf = (index: number, group: DupeGroup) =>
    keep[index] ?? group.items[0]?.id ?? -1;

  async function recycleExtra(index: number, group: DupeGroup) {
    const kept = keptIdOf(index, group);
    const doomed = group.items.filter((i) => i.id !== kept).map((i) => ({ id: i.id, path: i.path }));
    if (doomed.length === 0) return;
    setWorking(true);
    try {
      await deleteForever(doomed);
      setArmed(null);
      setKeep((k) => {
        const next = { ...k };
        delete next[index];
        return next;
      });
      await report.refetch();
    } finally {
      setWorking(false);
    }
  }

  const scanning = report.isFetching;

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <IconButton label={t("actions.back")} onClick={() => navigate("/")}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label flex-1">{t("dupes.title")}</span>
        <Segmented
          aria-label={t("dupes.threshold")}
          value={threshold}
          onChange={(v) => {
            setThreshold(v as Threshold);
            setKeep({});
            setArmed(null);
          }}
          options={[
            { value: "all", label: t("dupes.size_all") },
            { value: "1mb", label: "1 MB+" },
            { value: "10mb", label: "10 MB+" },
          ]}
        />
        <IconButton
          label={t("dupes.rescan")}
          onClick={() => void report.refetch()}
          className={cn(scanning && "text-accent")}
        >
          <RefreshCw size={18} className={cn(scanning && "animate-spin")} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {/* summary */}
        {groups.length > 0 && (
          <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="micro-label mb-1">{t("dupes.groups")}</div>
              <div className="font-mono text-2xl text-tprimary">{formatCount(groups.length)}</div>
            </div>
            <div>
              <div className="micro-label mb-1">{t("dupes.files")}</div>
              <div className="font-mono text-2xl text-tsecondary">{formatCount(totalFiles)}</div>
            </div>
            <div>
              <div className="micro-label mb-1">{t("dupes.reclaimable")}</div>
              <div className="font-mono text-2xl text-accent">{formatBytes(totalWasted)}</div>
            </div>
            {report.data && (
              <div className="ml-auto font-mono text-[11px] text-ttertiary">
                {t("dupes.scanned", {
                  candidates: formatCount(report.data.candidates),
                  hashed: formatCount(report.data.hashed),
                })}
              </div>
            )}
          </div>
        )}

        {/* live scan progress: the bar is exact (Rust knows both totals) and
            shows which of the two passes is running; the pending state below
            still covers the SQL phase before the first event arrives */}
        {report.isFetching && progress && (
          <div className="mb-5">
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-tsecondary">
                {progress.stage === "head" ? t("dupes.stage_head") : t("dupes.stage_full")}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ttertiary">
                {formatCount(progress.done)} / {formatCount(progress.total)}
              </span>
            </div>
            <div className="h-[4px] w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full rounded-pill bg-accent transition-[width] duration-150 ease-out"
                style={{
                  width: `${
                    progress.total > 0 ? Math.max(1.5, (progress.done / progress.total) * 100) : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {/* states */}
        {report.isPending && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Copy size={28} className="text-ttertiary" />
            <p className="text-sm text-tsecondary">
              {progress ? t("dupes.running_hint") : t("dupes.running")}
            </p>
            {!progress && (
              <p className="max-w-[46ch] text-[13px] text-ttertiary">{t("dupes.running_hint")}</p>
            )}
          </div>
        )}

        {report.isError && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="text-sm text-tsecondary">{t("dupes.failed")}</p>
            <button
              type="button"
              onClick={() => void report.refetch()}
              className="rounded-pill bg-surface-2 px-4 py-2 text-[13px] text-tprimary transition-colors hover:bg-surface-3"
            >
              {t("dupes.rescan")}
            </button>
          </div>
        )}

        {!report.isPending && !report.isError && groups.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Copy size={28} className="text-ttertiary" />
            <p className="text-sm text-tprimary">{t("dupes.empty_title")}</p>
            <p className="max-w-[46ch] text-[13px] text-ttertiary">{t("dupes.empty_hint")}</p>
          </div>
        )}

        {/* groups */}
        <div className="flex flex-col gap-4">
          {groups.map((group, index) => {
            const kept = keptIdOf(index, group);
            const isArmed = armed === index;
            const freed = group.size * (group.items.length - 1);
            return (
              <section
                key={`${group.size}-${group.items[0]?.id ?? index}`}
                className="overflow-hidden rounded-control border border-hairline bg-surface-1"
              >
                <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
                  <span className="font-mono text-[12px] text-tsecondary">
                    {group.items.length} × {formatBytes(group.size)}
                  </span>
                  <span className="font-mono text-[12px] text-accent">
                    {t("dupes.frees", { size: formatBytes(freed) })}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => setArmed(isArmed ? null : index)}
                      className={cn(
                        "rounded-pill px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50",
                        isArmed
                          ? "bg-surface-3 text-tsecondary"
                          : "text-tsecondary hover:bg-surface-2 hover:text-tprimary",
                      )}
                    >
                      {isArmed ? t("dupes.cancel") : t("dupes.arm")}
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void recycleExtra(index, group)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50",
                        isArmed
                          ? "bg-accent/15 text-accent hover:bg-accent/25"
                          : "pointer-events-none opacity-40",
                      )}
                    >
                      <Trash2 size={14} />
                      {t("dupes.recycle", { count: group.items.length - 1 })}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 p-3">
                  {group.items.map((item) => {
                    const known = thumbs[item.id];
                    const rawPath =
                      known && known.status === "ok" ? (known.path ?? null) : item.thumbPath;
                    const isKept = item.id === kept;
                    return (
                      <figure
                        key={item.id}
                        className={cn(
                          "w-[176px] shrink-0 overflow-hidden rounded-control border transition-colors",
                          isKept ? "border-accent/60 bg-accent/[.06]" : "border-hairline bg-surface-2",
                        )}
                      >
                        <div className="relative h-[112px] bg-surface-2">
                          {rawPath ? (
                            <img
                              src={thumbSrc(rawPath)}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className="h-full w-full select-none object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-ttertiary">
                              {item.path.split(".").pop()?.toUpperCase()}
                            </div>
                          )}
                          {isKept && (
                            <span className="absolute left-2 top-2 rounded-pill bg-accent px-2 py-0.5 font-mono text-[10px] text-black">
                              {t("dupes.keep")}
                            </span>
                          )}
                        </div>

                        <figcaption className="flex flex-col gap-1 p-2.5">
                          <span className="truncate text-[12px] text-tprimary" title={item.path}>
                            {baseName(item.path)}
                          </span>
                          <span
                            className="truncate font-mono text-[10px] text-ttertiary"
                            title={item.path}
                          >
                            {shortDir(item.path)}
                          </span>
                          <span className="font-mono text-[10px] text-ttertiary">
                            {new Date(item.mtime * 1000).toLocaleDateString()}
                            {formatResolution(item.width, item.height)
                              ? ` · ${formatResolution(item.width, item.height)}`
                              : ""}
                          </span>

                          <div className="mt-1.5 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setKeep((k) => ({ ...k, [index]: item.id }))}
                              className={cn(
                                "flex-1 rounded-pill px-2 py-1 text-[11px] transition-colors",
                                isKept
                                  ? "bg-accent/15 text-accent"
                                  : "bg-surface-3 text-tsecondary hover:text-tprimary",
                              )}
                            >
                              {t("dupes.keep_this")}
                            </button>
                            <IconButton
                              label={t("dupes.reveal")}
                              onClick={() =>
                                void invoke("reveal_path", { path: item.path }).catch(() => undefined)
                              }
                            >
                              <FolderSearch size={14} />
                            </IconButton>
                          </div>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
