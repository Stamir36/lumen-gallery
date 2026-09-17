import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { baseName } from "@/lib/format";
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
  const row = queue[index];
  if (!open || !row) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={baseName(row.path)}
      className="fixed inset-0 z-[120] bg-black"
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


