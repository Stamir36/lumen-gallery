import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  Check,
  Copy,
  FolderSearch,
  HardDrive,
  Layers,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Segmented } from "@/components/ui/Segmented";
import { DragRegion } from "@/components/WindowTitleBar";
import { formatBytes, formatCount } from "@/lib/api";
import { baseName, formatResolution } from "@/lib/format";
import { enqueueRows, thumbSrc, useThumbStore } from "@/lib/thumbs";
import { deleteForever } from "@/lib/mediaActions";
import { tauriAvailable } from "@/lib/assets";
import { toast } from "sonner";

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

/**
 * Group ordering. "saved" is the default — the biggest win first; "copies" is
 * for hunting shots that got duplicated again and again.
 */
type SortMode = "saved" | "copies";

/** Copies shown before a group collapses behind a "+N more" row. */
const GROUP_PREVIEW = 6;

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

/**
 * Sort picker: one quiet icon button that opens a small menu.
 *
 * Two chunky segmented groups sat in this header before, and together they
 * outweighed everything else on the screen (user note: "слишком большие и
 * бросаются в глаза"). A menu says the same thing with one 40px control, and
 * the label tells you which order is active without opening it.
 */
function SortPicker({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const { t } = useTranslation();
  const options: { value: SortMode; labelKey: string; icon: React.ReactNode }[] = [
    { value: "saved", labelKey: "dupes.sort_saved", icon: <ArrowDownWideNarrow size={15} /> },
    { value: "copies", labelKey: "dupes.sort_copies", icon: <Layers size={15} /> },
  ];
  const active = options.find((o) => o.value === value) ?? options[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${t("dupes.sort")}: ${t(active.labelKey)}`}
          title={`${t("dupes.sort")}: ${t(active.labelKey)}`}
          className="flex h-8 items-center gap-2 rounded-pill bg-white/[.04] px-3 text-[12px] text-tsecondary transition-colors duration-[160ms] hover:bg-white/[.08] hover:text-tprimary"
        >
          {active.icon}
          <span className="whitespace-nowrap">{t(active.labelKey)}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[200px] rounded-[18px] border border-hairline bg-surface-2 p-1.5 shadow-popover"
        >
          <DropdownMenu.Label className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ttertiary">
            {t("dupes.sort")}
          </DropdownMenu.Label>
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.value}
              onSelect={() => onChange(o.value)}
              className="flex h-10 cursor-default items-center gap-3 rounded-[12px] px-3 text-sm text-tsecondary outline-none transition-colors data-[highlighted]:bg-white/[.07] data-[highlighted]:text-tprimary"
            >
              <Check size={15} className={cn(value === o.value ? "opacity-100" : "opacity-0")} />
              {t(o.labelKey)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
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
  /** group KEY (not index — sorting must not shuffle choices) -> kept id */
  const [keep, setKeep] = useState<Record<string, number>>({});
  /** group key armed for removal — the second click is the confirmation */
  const [armed, setArmed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  /** live scan progress (null = no scan in flight or not in the app) */
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [sort, setSort] = useState<SortMode>("saved");
  /** group keys whose copies are fully expanded (big groups start collapsed) */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** bulk pass in flight: the floating bar reports how far it got */
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  /** bulk action armed — the second press is the confirmation */
  const [bulkArmed, setBulkArmed] = useState(false);

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

  const groups = useMemo(() => {
    const list = [...(report.data?.groups ?? [])];
    if (sort === "copies") {
      list.sort(
        (a, b) => b.items.length - a.items.length || b.wastedBytes - a.wastedBytes,
      );
    }
    return list;
  }, [report.data, sort]);
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
  //
  // BUG FIX: the old guard skipped anything with a `thumbPath`, so rows whose
  // cached file had gone missing (cleared cache dir, failed video capture that
  // still recorded a path) shimmered as the raw ext chip forever. An item now
  // counts as served only when the thumb store says ok OR a stale-free path is
  // plausible; anything else — including videos — is routed through
  // `enqueueRows`, which sends images to the Rust engine and videos to the
  // serialized webview capture. The store's retry budget still prevents loops.
  useEffect(() => {
    if (!tauriAvailable() || groups.length === 0) return;
    const stale: { id: number; path: string; kind: "image" | "video"; ext: string; size: number; mtime: number }[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (asked.current.has(item.id)) continue;
        asked.current.add(item.id);
        const known = thumbs[item.id];
        const served = known && known.status === "ok";
        // keep the warm path only when the store agrees; when nothing is known
        // yet, let the generators decide (they re-check the cache on disk)
        if (!served) {
          stale.push({
            id: item.id,
            path: item.path,
            // the dupes report does not carry `kind` — videos are exactly the
            // rows whose extensions the image decoders cannot read
            kind: "video" as const,
            ext: item.path.split(".").pop() ?? "",
            size: item.size,
            mtime: item.mtime,
          });
        }
      }
    }
    if (stale.length > 0) {
      // enqueueRows seeds + routes both kinds; images it cannot name are
      // handled by the Rust engine's own extension table
      enqueueRows(stale as unknown as Parameters<typeof enqueueRows>[0]);
    }
  }, [groups, thumbs]);

  /** Stable identity of a group across sorts/filters: size + oldest id. */
  const keyOf = (group: DupeGroup, index: number) =>
    `${group.size}-${group.items[0]?.id ?? index}`;

  const keptIdOf = (key: string, group: DupeGroup) =>
    keep[key] ?? group.items[0]?.id ?? -1;

  async function recycleExtra(group: DupeGroup, key: string) {
    const kept = keptIdOf(key, group);
    const doomed = group.items.filter((i) => i.id !== kept).map((i) => ({ id: i.id, path: i.path }));
    if (doomed.length === 0) return;
    setWorking(true);
    try {
      await deleteForever(doomed);
      setArmed(null);
      setKeep((k) => {
        const next = { ...k };
        delete next[key];
        return next;
      });
      await report.refetch();
    } finally {
      setWorking(false);
    }
  }

  /**
   * The whole report at once: keep the user's pick (or the oldest copy) in
   * every group and recycle the rest. Sequential on purpose — a group that
   * fails leaves the remaining groups untouched and the counter shows where
   * it stopped, which a fire-and-forget Promise.all could not.
   */
  async function recycleAll() {
    setWorking(true);
    setBulk({ done: 0, total: groups.length });
    try {
      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        const key = keyOf(group, i);
        const kept = keptIdOf(key, group);
        const doomed = group.items
          .filter((it) => it.id !== kept)
          .map((it) => ({ id: it.id, path: it.path }));
        if (doomed.length > 0) await deleteForever(doomed, { silent: true });
        setBulk({ done: i + 1, total: groups.length });
      }
      toast.success(t("dupes.bulk_done", { count: groups.length }));
      setKeep({});
      setBulkArmed(false);
      await report.refetch();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBulk(null);
      setWorking(false);
    }
  }

  const scanning = report.isFetching;

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* titlebar row: identical chrome to the other tool pages (tools, disk).
          The drag region makes the frameless window draggable from this page
          too — it was fixed-size chrome before (user note). */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <IconButton label={t("actions.back")} onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label">{t("dupes.title")}</span>
        <DragRegion />
        <Segmented
          aria-label={t("dupes.threshold")}
          size="sm"
          tone="quiet"
          className="ml-2"
          value={threshold}
          onChange={(v) => {
            setThreshold(v as Threshold);
            setKeep({});
            setArmed(null);
            setExpanded(new Set());
          }}
          options={[
            { value: "all", label: t("dupes.size_all") },
            { value: "1mb", label: "1 MB+" },
            { value: "10mb", label: "10 MB+" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {/* sort order as a small menu, not a second pill group: two chunky
              segmented controls in one header read as a wall of buttons */}
          <SortPicker value={sort} onChange={setSort} />
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
        <div className={cn("flex flex-col gap-4 px-6", groups.length > 0 ? "pb-28" : "pb-8")}>
          {groups.map((group, index) => {
            const key = keyOf(group, index);
            const kept = keptIdOf(key, group);
            const isArmed = armed === key;
            const freed = group.size * (group.items.length - 1);
            const isOpen = expanded.has(key);
            const shown = isOpen ? group.items : group.items.slice(0, GROUP_PREVIEW);
            const hidden = group.items.length - shown.length;
            return (
              <motion.section
                key={key}
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
                      onClick={() => setArmed(isArmed ? null : key)}
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
                      onClick={() => void recycleExtra(group, key)}
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
                  {shown.map((item) => {
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
                          onClick={() => setKeep((k) => ({ ...k, [key]: item.id }))}
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
                              onClick={() => setKeep((k) => ({ ...k, [key]: item.id }))}
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

                  {/* big groups start collapsed: 20 copies of one clip should
                      not push every other group off the screen */}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded((s) => new Set(s).add(key))}
                      className="flex w-[176px] shrink-0 flex-col items-center justify-center gap-2 rounded-control border border-dashed border-hairline text-ttertiary transition-colors duration-[160ms] hover:bg-surface-1 hover:text-tsecondary"
                    >
                      <span className="font-mono text-[15px] tabular-nums">+{hidden}</span>
                      <span className="px-3 text-center text-[11px] leading-snug">
                        {t("dupes.show_more")}
                      </span>
                    </button>
                  )}
                  {isOpen && group.items.length > GROUP_PREVIEW && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((s) => {
                          const next = new Set(s);
                          next.delete(key);
                          return next;
                        })
                      }
                      className="flex h-[112px] w-[176px] shrink-0 items-center justify-center rounded-control border border-dashed border-hairline font-mono text-[11px] text-ttertiary transition-colors duration-[160ms] hover:bg-surface-1 hover:text-tsecondary"
                    >
                      {t("dupes.show_less")}
                    </button>
                  )}
                </div>
              </motion.section>
            );
          })}
        </div>
      </div>

      {/* floating bulk bar: glass is allowed on exactly this kind of overlay
          (DESIGN.md §3 whitelist — "floating selection action bar") */}
      {groups.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-pill border border-white/[.08] px-2 py-2 pl-5 shadow-[inset_0_1px_0_rgba(255,255,255,.10),0_8px_24px_rgba(0,0,0,.45)] backdrop-blur-[28px] backdrop-saturate-150" style={{ background: "linear-gradient(180deg, rgba(14,14,18,.68), rgba(14,14,18,.55))" }}>
            {bulk ? (
              <span className="font-mono text-[11px] tabular-nums text-tsecondary">
                {t("dupes.bulk_progress", {
                  done: formatCount(bulk.done),
                  total: formatCount(bulk.total),
                })}
              </span>
            ) : (
              <>
                <span className="font-mono text-[11px] tabular-nums text-tsecondary">
                  {t("dupes.bulk_hint", {
                    groups: formatCount(groups.length),
                    size: formatBytes(totalWasted),
                  })}
                </span>
                {bulkArmed && (
                  <button
                    type="button"
                    onClick={() => setBulkArmed(false)}
                    className="rounded-pill px-3 py-1.5 text-[12px] text-tsecondary transition-colors hover:bg-white/[.08] hover:text-tprimary"
                  >
                    {t("dupes.cancel")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={working}
                  onClick={() => (bulkArmed ? void recycleAll() : setBulkArmed(true))}
                  className={cn(
                    "flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[12px] transition-colors disabled:opacity-50",
                    bulkArmed
                      ? "bg-accent text-black hover:bg-accent/85"
                      : "bg-white/[.10] text-tprimary hover:bg-white/[.16]",
                  )}
                >
                  <Trash2 size={14} />
                  {bulkArmed ? t("dupes.bulk_confirm") : t("dupes.bulk_arm")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
