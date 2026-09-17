import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Heart, LayoutGrid, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatCount, type MediaRow } from "@/lib/api";
import { MonoChip } from "@/components/ui/Chip";
import { buildGrid, HEADER_HEIGHT, type GridItem } from "@/lib/gridItems";
import { GRID_GAP } from "@/lib/justified";
import { useElementWidth } from "@/lib/hooks";
import { formatDuration, formatResolution, baseName } from "@/lib/format";
import { setFavorite, trashMedia } from "@/lib/mediaActions";
import { enqueueRows, seedThumbs, setViewportIds } from "@/lib/thumbs";
import { useLibraryUi } from "@/state/library-ui";
import { MediaCard } from "./MediaCard";
import { Masonry } from "./Masonry";
import { ThumbTile } from "./ThumbTile";
import { SkeletonGrid } from "./Skeletons";
import { EmptyState } from "./EmptyState";
import { CollageOverlay } from "./CollageOverlay";

const CARD_RADIUS = 12;
const GUTTER = 36;
/** 8px scrollbar is part of the measured width (DESIGN.md §9). */
const SCROLLBAR = 8;

export interface MediaGridProps {
  rows: MediaRow[];
  /** first load for this query — nothing to keep on screen yet */
  pending: boolean;
  error: unknown;
  query: string;
  emptyKind: "media" | "favorites" | "trash" | "albums" | "search";
  onRetry: () => void;
  onAddLibrary: () => void;
  /** folder shelf (folder routes) rendered above the scroller */
  folderZone?: React.ReactNode;
}

export function MediaGrid({
  rows,
  pending,
  error,
  query,
  emptyKind,
  onRetry,
  onAddLibrary,
  folderZone,
}: MediaGridProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const width = useElementWidth(hostRef, 1280);
  const usable = Math.max(220, width - GUTTER * 2 - SCROLLBAR);

  const view = useLibraryUi((s) => s.view);
  const sort = useLibraryUi((s) => s.sort);
  const selectionMode = useLibraryUi((s) => s.selectionMode);
  const selected = useLibraryUi((s) => s.selected);
  const toggleSelected = useLibraryUi((s) => s.toggleSelected);
  const toggleSelectionMode = useLibraryUi((s) => s.toggleSelectionMode);
  const clearSelection = useLibraryUi((s) => s.clearSelection);
  const setQ = useLibraryUi((s) => s.setQ);

  const built = useMemo(
    () => buildGrid(rows, usable, view, sort, i18n.language),
    [rows, usable, view, sort, i18n.language],
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  /** collage multi-viewer: 2–6 selected items, tallest-first order kept */
  const collageRows = useMemo(
    () => rows.filter((r) => selectedSet.has(r.id)),
    [rows, selectedSet],
  );
  const [collageOpen, setCollageOpen] = useState(false);
  /** presets exist for 2–6 tiles (FIX 4); outside that range the action is off */
  const collageReady = selected.length >= 2 && selected.length <= 6;

  useEffect(() => {
    if (collageOpen && collageRows.length < 2) setCollageOpen(false);
  }, [collageOpen, collageRows.length]);

  // ---------- sticky date header ----------
  const [rangeStart, setRangeStart] = useState(0);
  const startItem = built.items[rangeStart];
  const activeGroup =
    !pending && startItem && startItem.kind !== "header" && built.groups.length > 1
      ? built.groups[built.groupOf[rangeStart]]
      : null;

  // ---------- keyboard navigation (arrows + Enter, STEP 6 a11y) ----------
  const focusOrder = useMemo(
    () =>
      built.items.flatMap((item, itemIndex) =>
        item.kind === "cells"
          ? item.cells.map((cell, cellIndex) => ({
              item: itemIndex,
              cell: cellIndex,
              id: cell.media.id,
            }))
          : item.kind === "listrow"
            ? [{ item: itemIndex, cell: 0, id: item.media.id }]
            : [],
      ),
    [built],
  );
  // WARM SEED (S1.1): rows that already carry a cached thumbnail render from
  // the DB value — no request, no placeholder flash
  useEffect(() => {
    seedThumbs(rows);
  }, [rows]);

  /**
   * Visible-first thumbnail priming (S1.2): the range decides what is generated
   * next, and its ids are the queue's priority for the next flush. The margin of
   * two rows keeps a small prefetch window warm without a decoder storm.
   */
  const primeThumbs = useCallback(
    (startIndex: number, endIndex: number) => {
      const from = Math.max(0, startIndex - 2);
      const to = Math.min(built.items.length - 1, endIndex + 2);
      const inRange: MediaRow[] = [];
      for (let i = from; i <= to; i += 1) {
        const item = built.items[i];
        if (!item) continue;
        if (item.kind === "cells") for (const c of item.cells) inRange.push(c.media);
        else if (item.kind === "listrow") inRange.push(item.media);
      }
      setViewportIds(inRange.map((r) => r.id));
      enqueueRows(inRange);
    },
    [built],
  );

  const [focusPos, setFocusPos] = useState<number | null>(null);

  useEffect(() => setFocusPos(null), [built]);

  // per-mode scroll restoration (FIX 3): saving is rAF-cheap, restoring runs
  // once per browse-mode mount
  const browse = useLibraryUi((s) => s.browse);
  const saveScroll = useLibraryUi((s) => s.saveScroll);
  const savedOffset = useLibraryUi((s) => s.scrollOffsets[browse]);
  const restored = useRef(false);
  useEffect(() => {
    restored.current = false;
  }, [browse]);
  const restoreSoon = useCallback(() => {
    if (restored.current || savedOffset <= 0) return;
    restored.current = true;
    virtuoso.current?.scrollToIndex({ index: 0, offset: savedOffset, behavior: "auto" });
  }, [savedOffset]);

  const focusId =
    focusPos !== null && focusOrder[focusPos] ? focusOrder[focusPos].id : null;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (focusOrder.length === 0) return;
      const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "];
      if (!keys.includes(e.key)) return;
      e.preventDefault();

      if (e.key === "Enter" || e.key === " ") {
        if (focusPos !== null && focusOrder[focusPos]) {
          toggleSelected(focusOrder[focusPos].id);
        }
        return;
      }

      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(focusOrder.length - 1, next));
        setFocusPos(clamped);
        virtuoso.current?.scrollIntoView({ index: focusOrder[clamped].item, behavior: "auto" });
      };

      if (e.key === "Home") return move(0);
      if (e.key === "End") return move(focusOrder.length - 1);
      if (focusPos === null) return move(0);

      const cur = focusOrder[focusPos];
      if (e.key === "ArrowRight") return move(focusPos + 1);
      if (e.key === "ArrowLeft") return move(focusPos - 1);

      const down = e.key === "ArrowDown";
      for (let i = focusPos + (down ? 1 : -1); i >= 0 && i < focusOrder.length; ) {
        const cand = focusOrder[i];
        const jump = down ? cand.item > cur.item : cand.item < cur.item;
        if (jump) {
          // pick the cell in that row closest to the current column
          let best = i;
          let bestDelta = Math.abs(cand.cell - cur.cell);
          let k = i + (down ? 1 : -1);
          while (
            k >= 0 &&
            k < focusOrder.length &&
            focusOrder[k].item === cand.item
          ) {
            const delta = Math.abs(focusOrder[k].cell - cur.cell);
            if (delta < bestDelta) {
              best = k;
              bestDelta = delta;
            }
            k += down ? 1 : -1;
          }
          return move(best);
        }
        i += down ? 1 : -1;
      }
    },
    [focusOrder, focusPos, toggleSelected],
  );

  // ---------- states ----------
  const isEmpty = rows.length === 0;
  const displayPending = pending && isEmpty;
  /** Mode/state key: view switches and skeleton→grid crossfade through it. */
  const bodyKey = `${view}-${displayPending ? "skeleton" : error ? "error" : isEmpty ? "empty" : "grid"}`;

  let body: React.ReactNode;
  if (displayPending) {
    body = <SkeletonGrid width={usable} view={view} />;
  } else if (error) {
    body = (
      <EmptyState
        icon="error"
        title={t("grid.error_title")}
        mono={String(error).slice(0, 120)}
        cta={t("grid.retry")}
        onCta={onRetry}
      />
    );
  } else if (isEmpty) {
    const search = emptyKind === "search";
    body = (
      <EmptyState
        icon={search ? "search" : "empty"}
        title={t(`grid.empty_${emptyKind}`)}
        mono={
          search
            ? `“${query}” · 0 ${t("grid.results_suffix")}`
            : t("grid.empty_hint")
        }
        cta={
          search
            ? t("grid.clear_search")
            : emptyKind === "media"
              ? t("grid.add_library")
              : undefined
        }
        onCta={search ? () => setQ("") : emptyKind === "media" ? onAddLibrary : undefined}
      />
    );
  } else if (view === "masonry") {
    body = (
      <Masonry
        rows={rows}
        radius={CARD_RADIUS}
        selectionMode={selectionMode}
        selectedIds={selected}
        onToggleSelect={toggleSelected}
      />
    );
  } else {
    body = (
      <Virtuoso
        ref={virtuoso}
        className="h-full"
        totalCount={built.items.length}
        computeItemKey={(index) => built.items[index].key}
        defaultItemHeight={view === "list" ? HEADER_HEIGHT : 240}
        increaseViewportBy={{ top: 700, bottom: 1200 }}
        rangeChanged={(range) => {
          setRangeStart(range.startIndex);
          primeThumbs(range.startIndex, range.endIndex);
          restoreSoon();
        }}
        scrollerRef={(el) => {
          // scroll-offset persistence (FIX 3): attach one passive listener
          const scroller = el instanceof HTMLElement ? el : null;
          if (!scroller) return;
          const onScroll = () => {
            if (scroller.scrollTop > 0) saveScroll(scroller.scrollTop);
          };
          scroller.addEventListener("scroll", onScroll, { passive: true });
          return () => scroller.removeEventListener("scroll", onScroll);
        }}
        components={{ Footer: () => <div style={{ height: 104 }} /> }}
        itemContent={(index) => (
          <GridRow
            item={built.items[index]}
            view={view}
            focusId={focusId}
            selectionMode={selectionMode}
            selected={selectedSet}
            onToggleSelect={toggleSelected}
            onActivate={(id) => {
              // TODO(phase 4): open the item in the viewer instead
              if (!selectionMode) toggleSelectionMode();
              toggleSelected(id);
            }}
          />
        )}
      />
    );
  }

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full min-h-0 outline-none"
      aria-label={t("grid.aria_grid")}
    >
      <div className="flex h-full min-h-0 flex-col">
        {folderZone}
        <div className="min-h-0 flex-1">
          {/* view-mode switch + skeleton→grid crossfade (180ms, §8) */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={bodyKey}
              initial={reduced ? false : { opacity: 0, scale: 0.995 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.995 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              className="h-full"
            >
              {body}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* sticky date header — solid tonal, NEVER glass (v2.2) */}
      <AnimatePresence initial={false}>
        {activeGroup && (
          <motion.div
            key={activeGroup.key}
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.14, ease: "easeOut" }}
            /* EDGE-TO-EDGE band (F1): the tonal fill + hairline live on the
               full-width element; only the LABEL is inset to the grid gutter,
               so the band no longer shows empty margins left and right */
            className="pointer-events-none absolute inset-x-0 top-0 z-30 border-b border-hairline bg-surface-1"
          >
            <div
              className="flex h-11 items-center gap-3"
              style={{ paddingLeft: GUTTER, paddingRight: GUTTER }}
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-tsecondary">
                {activeGroup.label}
              </span>
              <span className="font-mono text-[11px] text-ttertiary">
                {formatCount(activeGroup.count)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            role="toolbar"
            aria-label={t("counts.selected", { count: selected.length })}
            /* frosted glass pill (v2.1 recipe, whitelisted floating pill):
               h56, radius 999, 40px icons, mono counter */
            className="glass absolute bottom-6 left-1/2 z-40 flex h-14 -translate-x-1/2 items-center gap-1 rounded-pill p-2"
          >
            <span className="mx-1 flex h-9 items-center rounded-pill bg-white/[.07] px-3 font-mono text-[12px] tabular-nums text-tprimary">
              {t("counts.selected", { count: selected.length })}
            </span>
            <BarAction
              label={collageReady ? t("collage.open") : t("collage.range")}
              title={t("collage.open")}
              icon={<LayoutGrid size={16} />}
              disabled={!collageReady}
              onClick={() => setCollageOpen(true)}
            />
            <BarAction
              label={t("actions.favorite")}
              icon={<Heart size={16} />}
              onClick={() => void setFavorite(selected, true)}
            />
            <BarAction
              label={t("actions.trash")}
              icon={<Trash2 size={16} />}
              danger
              onClick={() => {
                void trashMedia(selected);
                clearSelection();
              }}
            />
            <BarAction
              label={t("actions.clear_selection")}
              icon={<X size={16} />}
              onClick={clearSelection}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {collageOpen && collageRows.length >= 2 && (
          <CollageOverlay rows={collageRows} onClose={() => setCollageOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function BarAction({
  label,
  title,
  icon,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  title?: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-pill text-tsecondary transition-colors duration-[160ms] hover:bg-white/[.10] hover:text-tprimary active:scale-[.97]",
        danger && "hover:text-danger",
        disabled && "opacity-35 hover:bg-transparent hover:text-tsecondary active:scale-100",
      )}
    >
      {icon}
    </button>
  );
}

function GridRow({
  item,
  view,
  focusId,
  selectionMode,
  selected,
  onToggleSelect,
  onActivate,
}: {
  item: GridItem;
  view: "justified" | "square" | "list" | "masonry";
  focusId: number | null;
  selectionMode: boolean;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onActivate: (id: number) => void;
}) {
  if (item.kind === "header") {
    return (
      <div
        className="flex items-center gap-3"
        style={{ height: item.height, paddingLeft: GUTTER, paddingRight: GUTTER }}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ttertiary">
          {item.label}
        </span>
        <span className="font-mono text-[11px] text-ttertiary">{formatCount(item.count)}</span>
      </div>
    );
  }

  if (item.kind === "listrow") {
    const { t } = useTranslation();
    const media = item.media;
    const isSelected = selected.has(media.id);
    const meta =
      media.kind === "video"
        ? (formatDuration(media.durationMs) ?? "—")
        : (formatResolution(media.width, media.height) ?? "—");
    return (
      <div
        className="flex items-center"
        style={{ height: item.height, paddingLeft: GUTTER, paddingRight: GUTTER }}
      >
        <button
          type="button"
          aria-label={baseName(media.path)}
          title={baseName(media.path)}
          onClick={() => onActivate(media.id)}
          className={cn(
            "group flex h-14 w-full items-center gap-4 rounded-control px-2 text-left transition-colors duration-[160ms] hover:bg-white/[.05]",
            isSelected && "bg-accent/[.10]",
            media.offline && "opacity-60",
            focusId === media.id && "ring-2 ring-accent/40",
          )}
        >
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
            <ThumbTile media={media} shimmer={false} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-tprimary">{baseName(media.path)}</span>
              {media.offline && <MonoChip tone="tonal">{t("offline.chip")}</MonoChip>}
            </div>
            <div className="truncate font-mono text-[11px] text-ttertiary">
              {media.path.slice(0, media.path.length - baseName(media.path).length - 1)}
            </div>
          </div>
          {media.favorite && <Heart size={14} className="shrink-0 text-tsecondary" fill="currentColor" />}
          <span className="w-24 shrink-0 text-right font-mono text-[11px] text-ttertiary">
            {meta}
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-[11px] text-ttertiary">
            {formatBytes(media.size)}
          </span>
          <span
            role="button"
            tabIndex={-1}
            aria-label="select"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(media.id);
            }}
            className={cn(
              "h-4 w-4 shrink-0 rounded-[6px] border transition-colors",
              isSelected ? "border-accent bg-accent" : "border-white/30",
              selectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          />
        </button>
      </div>
    );
  }

  const row = item;
  const cells: React.ReactNode[] = [];
  let x = 0;
  for (const cell of row.cells) {
    cells.push(
      <div
        key={cell.media.id}
        className="absolute top-0"
        style={{ left: x, width: cell.w, height: cell.h }}
      >
        <MediaCard
          media={cell.media}
          radius={CARD_RADIUS}
          focused={focusId === cell.media.id}
          selectionMode={selectionMode}
          selected={selected.has(cell.media.id)}
          onToggleSelect={onToggleSelect}
          onActivate={() => onActivate(cell.media.id)}
        />
      </div>,
    );
    x += cell.w + GRID_GAP;
  }

  // NOTE: absolute children are positioned against the PADDING box, so the
  // gutter must live on a wrapper and the cells inside a positioned box.
  return (
    <div
      className={cn("h-full", view === "square" && "overflow-visible")}
      style={{ height: row.height, paddingLeft: GUTTER, paddingRight: GUTTER }}
    >
      <div className="relative h-full">{cells}</div>
    </div>
  );
}
