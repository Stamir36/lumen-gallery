import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Copy,
  FolderSearch,
  HardDrive,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
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
 *
 * DESIGN.md v2.5 pass: the header is a WindowTitleBar-backed editorial bar
 * (micro-label + big reclaimable number instead of a raw counter row), groups
 * are tonal elev-1 cards with the hero stat on the left of each group header,
 * keep-state on an item is a ring + tinted caption, not a badge. Accent stays
 * inside the §3.3 anchors: progress bar, active keep state, one summary number.
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
      {/* titlebar row: identical chrome to the other tool pages (tools, disk) */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <IconButton label={t("actions.back")} onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label">{t("dupes.title")}</span>
        <Segmented
          aria-label={t("dupes.threshold")}
          className="ml-2"
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
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            label={t("dupes.rescan")}
            onClick={() => void report.refetch()}
            className={cn(scanning && "text-accent")}
          >
            <RefreshCw size={18} className={cn(scanning && "animate-spin")} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* hero summary: the reclaimable number IS the page headline; the two
            counters sit beside it in mono metadata, no micro-label spam */}
        {groups.length > 0 && (
          <div className="px-6 pb-2 pt-7">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <div className="micro-label mb-1.5">{t("dupes.reclaimable")}</div>
                <div className="font-mono text-[34px] font-medium leading-none text-accent">
                  {formatBytes(totalWasted)}
                </div>
              </div>
              <div className="flex gap-8 pb-0.5">
                <div>
                  <div className="font-mono text-lg leading-tight text-tprimary">
                    {formatCount(groups.length)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ttertiary">{t("dupes.groups")}</div>
                </div>
                <div>
                  <div className="font-mono text-lg leading-tight text-tsecondary">
                    {formatCount(totalFiles)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ttertiary">{t("dupes.files")}</div>
                </div>
              </div>
              {report.data && (
                <div className="ml-auto max-w-[30ch] pb-1 text-right font-mono text-[11px] leading-relaxed text-ttertiary">
                  {t("dupes.scanned", {
                    candidates: formatCount(report.data.candidates),
                    hashed: formatCount(report.data.hashed),
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* live scan progress: OUTSIDE the summary block so it is visible on
            the very first scan, before any group exists to render; the bar is
            exact (Rust knows both totals) and names the pass in flight, while
            the indeterminate pulse covers the SQL phase before the first event */}
        {scanning && (
          <div className={cn("px-6", groups.length > 0 ? "pb-5" : "pb-2 pt-7")}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-tsecondary">
                {progress
                  ? progress.stage === "head"
                    ? t("dupes.stage_head")
                    : t("dupes.stage_full")
                  : t("dupes.running")}
              </span>
              {progress ? (
                <span className="font-mono text-[11px] tabular-nums text-ttertiary">
                  {formatCount(progress.done)} / {formatCount(progress.total)}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-ttertiary">{t("dupes.running_hint")}</span>
              )}
            </div>
            <div className="h-[5px] w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-pill transition-[width] duration-150 ease-out",
                  progress ? "bg-gradient-to-r from-accent/60 to-accent" : "animate-pulse bg-accent/50",
                )}
                style={{
                  width: progress
                    ? `${Math.max(1.5, (progress.done / progress.total) * 100)}%`
                    : "100%",
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
            <Sparkles size={28} className="text-ttertiary" />
            <p className="text-sm text-tprimary">{t("dupes.empty_title")}</p>
            <p className="max-w-[46ch] text-[13px] text-ttertiary">{t("dupes.empty_hint")}</p>
          </div>
        )}

        {/* groups */}
        <div className="flex flex-col gap-4 px-6 pb-8">
          {groups.map((group, index) => {
            const kept = keptIdOf(index, group);
            const isArmed = armed === index;
            const freed = group.size * (group.items.length - 1);
            return (
              <motion.section
                key={`${group.size}-${group.items[0]?.id ?? index}`}
                layout={false}
                initial={false}
                className="overflow-hidden rounded-card bg-surface-2 shadow-[0_8px_24px_rgba(0,0,0,.35)]"
              >
                {/* group header: tonal (no hairline between header and items) —
                    the hero stat "N × size" leads, accent frees-figure after */}
                <div className="flex items-center gap-3 px-5 pb-3 pt-4">
                  <HardDrive size={15} className="shrink-0 text-ttertiary" />
                  <span className="font-mono text-[13px] tabular-nums text-tprimary">
                    {group.items.length} × {formatBytes(group.size)}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-accent">
                    +{formatBytes(freed)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => setArmed(isArmed ? null : index)}
                      className={cn(
                        "rounded-pill px-3.5 py-1.5 text-[12px] transition-colors disabled:opacity-50",
                        isArmed
                          ? "bg-surface-3 text-tsecondary"
                          : "text-tsecondary hover:bg-surface-3 hover:text-tprimary",
                      )}
                    >
                      {isArmed ? t("dupes.cancel") : t("dupes.arm")}
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void recycleExtra(index, group)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[12px] transition-colors disabled:opacity-50",
                        isArmed
                          ? "bg-accent text-black hover:bg-accent/85"
                          : "pointer-events-none opacity-40",
                      )}
                    >
                      <Trash2 size={14} />
                      {t("dupes.recycle", { count: group.items.length - 1 })}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 px-4 pb-4">
                  {group.items.map((item) => {
                    const known = thumbs[item.id];
                    const rawPath =
                      known && known.status === "ok" ? (known.path ?? null) : item.thumbPath;
                    const isKept = item.id === kept;
                    return (
                      <figure
                        key={item.id}
                        className={cn(
                          "w-[176px] shrink-0 overflow-hidden rounded-control transition-all duration-[160ms]",
                          // keep-state is a ring + tint, not a floating badge —
                          // the badge fought the thumbnail for attention
                          isKept
                            ? "bg-surface-3 ring-1 ring-accent/60"
                            : "bg-surface-1 ring-1 ring-white/[.04] hover:ring-white/[.12]",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setKeep((k) => ({ ...k, [index]: item.id }))}
                          className="relative block h-[112px] w-full cursor-pointer bg-surface-1 text-left"
                          title={t("dupes.keep_this")}
                        >
                          {rawPath ? (
                            <img
                              src={thumbSrc(rawPath)}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className={cn(
                                "h-full w-full select-none object-cover transition-opacity",
                                !isKept && "opacity-[.92]",
                              )}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-ttertiary">
                              {item.path.split(".").pop()?.toUpperCase()}
                            </div>
                          )}
                          {isKept && (
                            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-white">
                              {t("dupes.keep")}
                            </span>
                          )}
                        </button>

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
                          <span className="font-mono text-[10px] tabular-nums text-ttertiary">
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
                                  : "bg-surface-2 text-tsecondary hover:text-tprimary",
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
              </motion.section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
