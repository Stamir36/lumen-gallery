import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { MediaRow } from "@/lib/api";
import { MediaGrid } from "@/components/library/MediaGrid";
import { FolderGrid } from "@/components/library/FolderCards";
import { Segmented } from "@/components/ui/Segmented";
import { useLibraryUi } from "@/state/library-ui";
import { LibraryTopBar } from "@/components/library/LibraryTopBar";
import { StatusLine } from "@/components/library/StatusLine";
import { ViewerOverlay } from "@/components/viewer/ViewerOverlay";

/**
 * DEV-ONLY visual QA route (`#/grid-demo`): the real grid components rendered
 * with synthetic rows, so the layout (justified pack, sticky date headers,
 * hover contract, offline tiles, empty states) can be reviewed without a
 * Tauri runtime and without touching the user's library.
 *
 * Thumbs are inline SVG data URLs — no asset protocol, no disk, no writes.
 */
const PALETTE = [
  ["#2b3a55", "#5f7fa8"],
  ["#3d2b46", "#8b5f9e"],
  ["#243a2e", "#4f8a6a"],
  ["#3a2f1e", "#a8814f"],
  ["#2a2a33", "#6b6b7a"],
  ["#402a2a", "#a86a6a"],
];

function svgThumb(w: number, h: number, i: number) {
  const [a, b] = PALETTE[i % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,.18)"/><rect x="${w * 0.08}" y="${h * 0.72}" width="${w * 0.34}" height="${h * 0.08}" rx="4" fill="rgba(255,255,255,.22)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const RATIOS: [number, number][] = [
  [1600, 1067], [1600, 900], [900, 1600], [1200, 1200], [1600, 2000], [2000, 900],
  [1600, 1067], [1000, 1400], [1600, 900], [1400, 1400], [800, 1600], [2400, 1000],
];

const NOW = new Date();
const DAY = 86_400_000;

function mockRows(): MediaRow[] {
  const rows: MediaRow[] = [];
  for (let i = 0; i < 84; i += 1) {
    const [w, h] = RATIOS[i % RATIOS.length];
    // three date groups: today, yesterday, and last month
    const dayOffset = i < 14 ? 0 : i < 40 ? 1 : 27;
    const isVideo = i % 9 === 4;
    rows.push({
      id: i + 1,
      rootId: 1,
      path: `C:\\Pictures\\Shoot 2026\\IMG_${1200 + i}${isVideo ? ".MP4" : ".JPG"}`,
      kind: isVideo ? "video" : "image",
      ext: isVideo ? "mp4" : "jpg",
      size: 2_400_000 + i * 91_337,
      mtime: NOW.getTime() - dayOffset * DAY - i * 60_000,
      width: w,
      height: h,
      durationMs: isVideo ? 42_000 + i * 1_500 : null,
      favorite: i % 11 === 3,
      trashed: false,
      addedAt: NOW.getTime() - i * 3_600_000,
      thumbPath: i % 17 === 5 ? null : svgThumb(Math.min(w, 480), Math.round((Math.min(w, 480) * h) / w), i),
      dominantColor: i % 17 === 5 ? PALETTE[i % PALETTE.length][0] : null,
      offline: i % 23 === 7,
      thumbError: false,
    });
  }
  return rows;
}

export default function GridDemo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rows = useMemo(mockRows, []);
  const view = useLibraryUi((s) => s.view);
  const setView = useLibraryUi((s) => s.setView);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-hairline bg-surface-1 px-9">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex h-9 items-center gap-2 rounded-pill bg-surface-2 px-4 text-sm text-tsecondary transition-colors hover:text-tprimary"
        >
          <ArrowLeft size={15} />
          {t("actions.back")}
        </button>
        <span className="micro-label">dev · synthetic data</span>
        <Segmented
          className="ml-auto"
          aria-label={t("topbar.view_mode")}
          value={view}
          onChange={setView}
          options={[
            { value: "justified", label: t("topbar.view_justified") },
            { value: "masonry", label: t("topbar.view_masonry") },
            { value: "square", label: t("topbar.view_square") },
            { value: "list", label: t("topbar.view_list") },
          ]}
        />
      </div>
      <LibraryTopBar title={t("sidebar.library")} count={rows.length} />
      <div className="relative min-h-0 flex-1">
        <MediaGrid
          rows={rows}
          pending={false}
          error={null}
          query=""
          emptyKind="media"
          onRetry={() => undefined}
          onAddLibrary={() => undefined}
          folderZone={<FolderGrid rootId={1} dir={null} enabled={false} />}
        />
      </div>
      <StatusLine
        summary={{
          total: rows.length,
          bytes: rows.reduce((a, r) => a + r.size, 0),
          images: rows.filter((r) => r.kind === "image").length,
          videos: rows.filter((r) => r.kind === "video").length,
          favorites: rows.filter((r) => r.favorite).length,
          offline: rows.filter((r) => r.offline).length,
        }}
        lastScanAt={Date.now() - 42_000}
        scanning={false}
        scanText=""
      />
      {/* the real viewers, so #/grid-demo QA covers them too (STEP 1/2) */}
      <ViewerOverlay />
    </div>
  );
}
