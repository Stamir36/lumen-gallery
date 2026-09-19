import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { baseName } from "@/lib/format";
import { stopCardPreviews } from "@/components/library/MediaCard";
import { useViewer } from "@/state/viewer";
import { Lightbox } from "./Lightbox";
import { VideoPlayer } from "./VideoPlayer";

/**
 * Viewer overlay (STEP 3): rendered through a PORTAL at the end of <body>, so
 * the grid underneath is never re-rendered while the viewer is open — no
 * re-layout, no thumbnail churn, no lost scroll position. One queue, two
 * surfaces: images open the lightbox, videos the custom player.
 */
export function ViewerOverlay() {
  const { t } = useTranslation();
  const open = useViewer((s) => s.open);
  const queue = useViewer((s) => s.queue);
  const index = useViewer((s) => s.index);
  const rootRef = useRef<HTMLDivElement>(null);
  /** where the keyboard was before the viewer took over (B4) */
  const restoreRef = useRef<HTMLElement | null>(null);

  /**
   * B4 — FOCUS CONTRACT for a modal overlay:
   *  - remember the focused element, move focus INTO the dialog on open;
   *  - put it back on close. Without the restore the grid's arrow navigation
   *    (which lives on a focusable host div) died after every viewer round-trip;
   *  - keep Tab inside the dialog, which `aria-modal="true"` already promises.
   */
  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      restoreRef.current?.focus({ preventScroll: true });
      restoreRef.current = null;
    };
  }, [open]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusables = e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  // A hover scrub-preview left running behind the overlay is a decoder burning
  // CPU for nobody — on a big library that background load is exactly what makes
  // the whole UI feel stuck.
  useEffect(() => {
    if (open) stopCardPreviews();
  }, [open]);

  // P7 F2: cold external open — the boot surface (pure black, gallery hidden)
  // is removed the moment the viewer portal actually mounts. Boot failures
  // clear it in externalOpen's catch, so no path can strand a black screen.
  useEffect(() => {
    if (open) document.documentElement.classList.remove("boot-viewer");
  }, [open]);

  const row = queue[index];
  if (!open || !row) return null;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={baseName(row.path)}
      tabIndex={-1}
      onKeyDown={trapTab}
      className="fixed inset-0 z-[120] bg-black outline-none"
    >
      {row.kind === "video" ? (
        // key: a new item gets a fresh <video> (no stale decoder state)
        <VideoPlayer key={row.id} row={row} />
      ) : (
        <Lightbox row={row} />
      )}
      {/* screen-reader hint: the queue position (mono counter contract) */}
      <span className="sr-only">{t("viewer.position", { index: index + 1, total: queue.length })}</span>
    </div>,
    document.body,
  );
}


