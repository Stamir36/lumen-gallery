import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  const reduced = useReducedMotion();

  /**
   * P9 motion — the viewer grows OUT OF THE POINT THE USER CLICKED.
   *
   * The activation callbacks are deliberately id-only (`onActivate(id)`, B6) so
   * the grid's rows stay memoizable; rather than widen that contract, the last
   * pointer-down is recorded here. It is the click that opened the viewer, and
   * it is inside the card — the same thing a rect lookup would give, for every
   * activation path (grid, list, filmstrip, collage) at once. Older than 800ms
   * means the open came from somewhere else (external file, keyboard Enter) and
   * the viewer grows from the centre instead.
   */
  const pointerAt = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      pointerAt.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
  const origin = (() => {
    const p = pointerAt.current;
    return p && performance.now() - p.t < 800 ? `${p.x}px ${p.y}px` : "center";
  })();

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

  return createPortal(
    // AnimatePresence keeps the overlay mounted for the exit beat. The key is
    // CONSTANT ("viewer"), so walking the queue with the arrows never re-runs
    // the open animation — only opening and closing do.
    <AnimatePresence>
      {open && row ? (
        // F2 choreography — TWO layers, never one fading tree:
        //  1. backdrop (bg-black): OPAQUE the instant the viewer mounts, so no
        //     frame ever shows grid and viewer both semi-transparent; on close
        //     it fades 100ms only AFTER the content is gone (delay 140ms);
        //  2. content: scale .96→1 + fade 180ms from the clicked-card origin.
        //     On close it goes out first, 140ms.
        <div
          key="viewer"
          ref={rootRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={baseName(row.path)}
          onKeyDown={trapTab}
          // the dialog takes focus on open; a ring around the whole overlay is
          // noise, not feedback (its controls keep theirs)
          data-no-ring
          className="fixed inset-0 z-[120] outline-none"
        >
          <motion.div
            className="absolute inset-0 bg-black"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{
              opacity: 0,
              transition: { duration: 0.1, delay: 0.14, ease: "easeOut" },
            }}
          />
          <motion.div
            className="absolute inset-0"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: 0.14 } }
                : {
                    opacity: 0,
                    scale: 0.96,
                    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                  }
            }
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: origin }}
          >
            {row.kind === "video" ? (
              // key: a new item gets a fresh <video> (no stale decoder state)
              <VideoPlayer key={row.id} row={row} />
            ) : (
              <Lightbox row={row} />
            )}
            {/* screen-reader hint: the queue position (mono counter contract) */}
            <span className="sr-only">
              {t("viewer.position", { index: index + 1, total: queue.length })}
            </span>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}


