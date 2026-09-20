import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Heart, LayoutGrid, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatCount, type MediaRow } from "@/lib/api";
import { setFavorite, trashMedia, restoreTrash, deleteForever } from "@/lib/mediaActions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { PillButton } from "@/components/ui/PillButton";
import { MonoChip } from "@/components/ui/Chip";
import { buildGrid, HEADER_HEIGHT, type GridItem } from "@/lib/gridItems";
import { DENSITY_PARAMS, useAppSettings } from "@/lib/settings";
import { useElementWidth } from "@/lib/hooks";
import { formatDuration, formatResolution, baseName } from "@/lib/format";
import { enqueueRows, seedThumbs, setViewportIds } from "@/lib/thumbs";
import { armOpenWarm } from "@/lib/preload";
import { useViewer } from "@/state/viewer";
import { useLibraryUi } from "@/state/library-ui";
import { MediaCard } from "./MediaCard";
import { Masonry } from "./Masonry";
import { ThumbTile } from "./ThumbTile";
import { SkeletonGrid } from "./Skeletons";
import { EmptyState } from "./EmptyState";
import { ScrollTopFab } from "./ScrollTopFab";
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
  const clearSelection = useLibraryUi((s) => s.clearSelection);
  const setQ = useLibraryUi((s) => s.setQ);

  // FIX 4b: grid density drives row height + gutter, applied live
  const density = useAppSettings((s) => s.gridDensity);
  const metrics = DENSITY_PARAMS[density];

  const built = useMemo(
    () => buildGrid(rows, usable, view, sort, i18n.language, metrics),
    [rows, usable, view, sort, i18n.language, metrics],
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  /** trash view: selection bar swaps to Restore / Delete-forever (P6 FIX 4) */
  const trashView = emptyKind === "trash";
  /** confirmation for the real (recycle-bin) deletion */
  const [confirmTrash, setConfirmTrash] = useState<MediaRow[] | null>(null);
  const selectedRows = useMemo(
    () => (trashView ? rows.filter((r) => selectedSet.has(r.id)) : []),
    [rows, selectedSet, trashView],
  );
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
  // ---------- P9 motion: one entry stagger per route change ----------
  // Keyed on the ROUTE (not on the rows): a favourite toggle refetches the
  // query and must not replay the animation under the user's cursor.
  const route = useLibraryUi((s) => s.route);
  const routeKey = useMemo(() => JSON.stringify(route), [route]);
  const [stagger, setStagger] = useState(false);
  useEffect(() => {
    setStagger(true);
    const id = window.setTimeout(() => setStagger(false), 460);
    return () => window.clearTimeout(id);
  }, [routeKey]);

  const openViewer = useViewer((s) => s.openAt);
  const revealId = useViewer((s) => s.revealId);
  const clearReveal = useViewer((s) => s.clearReveal);
  const [rangeStart, setRangeStart] = useState(0);
  /** the Virtuoso scroller element, in STATE so effects can clean up (B13) */
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  // ---------- return to the grid (STEP 3) ----------
  // Closing the viewer drops the id we were looking at into the store; the grid
  // scrolls back to its row and clears the flag, so leaving the viewer never
  // lands you in a different place than you left. The grid itself is never
  // re-rendered while the viewer is open (portal), so its state is intact.
  useEffect(() => {
    // masonry owns its own scroller and consumes the reveal id itself
    if (revealId === null || view === "masonry") return;
    const itemIndex = built.items.findIndex((item) =>
      item.kind === "cells"
        ? item.cells.some((c) => c.media.id === revealId)
        : item.kind === "listrow"
          ? item.media.id === revealId
          : false,
    );
    if (itemIndex >= 0) {
      virtuoso.current?.scrollIntoView({ index: itemIndex, behavior: "auto" });
    }
    clearReveal();
  }, [revealId, built, clearReveal, view]);
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
   * B6: `rows` is a fresh array on every query refetch, so a closure over it
   * made `onActivate` fresh per render and re-rendered every mounted card. The
   * ref keeps the callback identity stable while still seeing current rows.
   */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const openViewerAt = useCallback(
    (id: number) => {
      const list = rowsRef.current;
      const at = list.findIndex((r) => r.id === id);
      openViewer(list, at < 0 ? 0 : at);
    },
    [openViewer],
  );

  // U1 — press-start: a card's pointerdown already asks for the ORIGINAL, so
  // the file is in flight by the time the click opens the viewer (~150 ms of
  // head start; a press that was actually a selection/context-menu gesture
  // simply gets evicted by the tiny warm cache — see lib/preload.ts)
  const warmOpen = useCallback((id: number) => {
    const row = rowsRef.current.find((r) => r.id === id);
    if (row) armOpenWarm(row);
  }, []);

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

  // B13: scroll-offset persistence — one passive listener, correctly torn down
  useEffect(() => {
    if (!scroller) return;
    const onScroll = () => {
      if (scroller.scrollTop > 0) saveScroll(scroller.scrollTop);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scroller, saveScroll]);
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

      // Space marks, Enter opens: the viewer is the primary action on a card
      if (e.key === " ") {
        if (focusPos !== null && focusOrder[focusPos]) {
          toggleSelected(focusOrder[focusPos].id);
        }
        return;
      }

      // STEP 3: Enter opens the viewer at the focused card's place in the
      // current view order — the same queue the arrows and the filmstrip walk
      if (e.key === "Enter") {
        const hit = focusPos === null ? focusOrder[0] : focusOrder[focusPos];
        const at = rows.findIndex((r) => r.id === hit.id);
        openViewer(rows, at < 0 ? 0 : at);
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
    [focusOrder, focusPos, openViewer, rows, toggleSelected],
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
        onPressStart={warmOpen}
        onActivate={(id) => {
          const at = rows.findIndex((r) => r.id === id);
          openViewer(rows, at < 0 ? 0 : at);
        }}
        revealId={revealId}
        onRevealed={clearReveal}
        // F11: masonry owns its scroller — hand it up for the scroll-top FAB
        onScroller={(el) => setScroller(el)}
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
        // B13: react-virtuoso accepts a ref callback but never calls its return
        // value, so the returned cleanup below was dead code and StrictMode
        // attached the listener twice. Hold the element in state and attach it
        // from an effect, where cleanup is guaranteed.
        scrollerRef={(el) => setScroller(el instanceof HTMLElement ? el : null)}
        components={{ Footer: () => <div style={{ height: 104 }} /> }}
        itemContent={(index) => (
          <GridRow
            item={built.items[index]}
            view={view}
            focusId={focusId}
            selectionMode={selectionMode}
            selected={selectedSet}
            // P9: 20ms per row, first 12 only (see index.css)
            staggerMs={stagger && index < 12 ? index * 20 : undefined}
            onToggleSelect={toggleSelected}
            // STEP 1: a click on the card (not the checkbox) opens the viewer at
            // that index; the queue is the CURRENT view order, so arrows and the
            // filmstrip walk exactly what the grid is showing
            onActivate={openViewerAt}
            onPressStart={warmOpen}
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
      // keyboard host: it takes focus so the arrows work, but the ring belongs
      // to the focused CARD (see .focused in MediaCard), not to the whole grid
      data-no-ring
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

      {/* F11 — scroll-top FAB: dead code until now (never mounted anywhere).
          One instance, whichever scroller the active view mode owns. */}
      {scroller && <ScrollTopFab target={scroller} />}

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
            {trashView ? (
              <>
                <BarAction
                  label={t("trash.restore")}
                  icon={<RotateCcw size={16} />}
                  onClick={() => {
                    void restoreTrash(selected);
                    clearSelection();
                  }}
                />
                <BarAction
                  label={t("trash.delete_forever")}
                  icon={<Trash2 size={16} />}
                  danger
                  onClick={() => setConfirmTrash(selectedRows)}
                />
              </>
            ) : (
              <BarAction
                label={t("actions.trash")}
                icon={<Trash2 size={16} />}
                danger
                onClick={() => {
                  void trashMedia(selected);
                  clearSelection();
                }}
              />
            )}
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

      {/* Delete-forever confirmation (P6 FIX 4): count + size in mono, and the
          recycle-bin note — the files stay recoverable from the OS bin */}
      <Dialog open={confirmTrash !== null} onOpenChange={(o) => !o && setConfirmTrash(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("trash.confirm_title")}</DialogTitle>
          </DialogHeader>
          <p className="font-mono text-[13px] tabular-nums text-tprimary">
            {t("trash.confirm_counts", {
              count: confirmTrash?.length ?? 0,
              size: formatBytes((confirmTrash ?? []).reduce((s, r) => s + (r.size || 0), 0)),
            })}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-tsecondary">
            {t("trash.confirm_note")}
          </p>
          <div className="mt-6 flex items-center justify-end gap-3">
            <PillButton variant="ghost" onClick={() => setConfirmTrash(null)}>
              {t("trash.cancel")}
            </PillButton>
            <PillButton
              variant="danger"
              onClick={() => {
                if (confirmTrash) void deleteForever(confirmTrash);
                setConfirmTrash(null);
                clearSelection();
              }}
            >
              {t("trash.delete_forever")}
            </PillButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* trash view, nothing selected: one-action pill — empty the whole trash */}
      <AnimatePresence>
        {trashView && selected.length === 0 && rows.length > 0 && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            role="toolbar"
            aria-label={t("trash.empty")}
            className="glass absolute bottom-6 right-6 z-40 flex h-14 items-center rounded-pill p-2"
          >
            <BarAction
              label={t("trash.empty")}
              icon={<Trash2 size={16} />}
              danger
              onClick={() => setConfirmTrash(rows)}
            />
          </motion.div>
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

/**
 * B6: memoized. It was plain, so any MediaGrid state change re-rendered every
 * visible row; a fresh `onActivate` closure per render also defeated the memo
 * on MediaCard. Both ends are fixed — stable callback here, memo below.
 */
const GridRow = memo(function GridRow({
  item,
  view,
  focusId,
  selectionMode,
  selected,
  staggerMs,
  onToggleSelect,
  onActivate,
  onPressStart,
}: {
  item: GridItem;
  view: "justified" | "square" | "list" | "masonry";
  focusId: number | null;
  selectionMode: boolean;
  selected: Set<number>;
  /** P9 entry stagger: animation delay in ms, undefined = settled */
  staggerMs?: number;
  onToggleSelect: (id: number) => void;
  onActivate: (id: number) => void;
  /** U1: card pointerdown — start fetching the original before the click */
  onPressStart?: (id: number) => void;
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
            aria-label={t("actions.select")}
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
  for (const cell of row.cells) {
    cells.push(
      <div
        key={cell.media.id}
        className="absolute top-0"
        style={{ left: cell.x, width: cell.w, height: cell.h }}
      >
        <MediaCard
          media={cell.media}
          radius={CARD_RADIUS}
          focused={focusId === cell.media.id}
          selectionMode={selectionMode}
          selected={selected.has(cell.media.id)}
          onToggleSelect={onToggleSelect}
          onActivate={() => onActivate(cell.media.id)}
          onPressStart={onPressStart ? () => onPressStart(cell.media.id) : undefined}
        />
      </div>,
    );
  }

  // NOTE: absolute children are positioned against the PADDING box, so the
  // gutter must live on a wrapper and the cells inside a positioned box.
  return (
    <div
      className={cn(
        "h-full",
        view === "square" && "overflow-visible",
        staggerMs !== undefined && "stagger-in",
      )}
      style={{
        height: row.height,
        paddingLeft: GUTTER,
        paddingRight: GUTTER,
        animationDelay: staggerMs !== undefined ? `${staggerMs}ms` : undefined,
      }}
    >
      <div className="relative h-full">{cells}</div>
    </div>
  );
});
