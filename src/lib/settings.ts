import { create } from "zustand";
import { toast } from "sonner";
import i18n, { writeSetting } from "@/i18n";
import { getDb } from "@/lib/db";
import { ACCENT_KEY as ACCENT_SETTING_KEY, DEFAULT_ACCENT, applyAccent } from "@/lib/accent";

/**
 * User-facing settings that the UI reacts to live, persisted in the `settings`
 * key/value table (the same place the Rust side reads `extensions` from).
 */
export const SCRUB_RATE_KEY = "video_scrub_rate";
/** Filename caption over the hover gradient (Settings › Appearance), default ON. */
export const HOVER_CAPTIONS_KEY = "hover_captions";
/** Swipe left/right to walk the photo queue in the lightbox, default ON. */
export const SWIPE_NAVIGATE_KEY = "viewer_swipe";
/// Where the floating control pill sits in the viewers (center | left | right).
export const PILL_ALIGN_KEY = "viewer_pill_align";
/** Start playing immediately when a video is opened (Settings › Appearance). */
export const VIDEO_AUTOPLAY_KEY = "video_autoplay";
/** Grid density preset (Settings › Appearance): comfort | medium | compact. */
export const DENSITY_KEY = "grid_density";

export type GridDensity = "comfort" | "medium" | "compact";
export const DEFAULT_DENSITY: GridDensity = "medium";

/**
 * Density → grid metrics. `targetH` is the justified target row height, `gap`
 * the gutter, `colW` the masonry column target width (square mode reads it as
 * the cell size target). LIVE: every consumer reads the store value.
 */
export const DENSITY_PARAMS: Record<
  GridDensity,
  { targetH: number; gap: number; colW: number }
> = {
  comfort: { targetH: 240, gap: 16, colW: 264 },
  medium: { targetH: 220, gap: 12, colW: 242 },
  compact: { targetH: 180, gap: 8, colW: 198 },
};

export type PillAlign = "center" | "left" | "right";
export const DEFAULT_PILL_ALIGN: PillAlign = "center";
/** Live frame-rate chip in the status line (Settings › Appearance), default OFF. */
export const SHOW_FPS_KEY = "perf_show_fps";
/** Show media inside excluded folders, marked with a chip. Default OFF. */
export const SHOW_EXCLUDED_KEY = "show_excluded";
/** Parallel thumbnail decoders (the Rust engine reads `thumb_workers` live). */
export const THUMB_WORKERS_KEY = "thumb_workers";
export const THUMB_WORKER_OPTIONS = [2, 4, 6, 8, 12] as const;
export const DEFAULT_THUMB_WORKERS = 4;

/** Hover scrub speed presets. 6× (the original) felt like a fast-forward. */
export const SCRUB_RATES = [1.5, 3, 6, 9] as const;
export const DEFAULT_SCRUB_RATE = 3;

export const WATCH_PROGRESS_PREFIX = "watch:";

interface AppSettingsState {
  /** playback rate used by the grid's hover preview */
  videoScrubRate: number;
  /** filename caption on card hover (F2) */
  hoverCaptions: boolean;
  /** a freshly opened video starts playing at once (Settings › Appearance) */
  videoAutoplay: boolean;
  /** horizontal swipe walks the photo queue (Settings › Appearance) */
  swipeNavigate: boolean;
  /** where the viewer control pill floats (Settings › Appearance) */
  pillAlign: PillAlign;
  /** mono FPS / worst-frame chip in the status line */
  showFps: boolean;
  /** media inside excluded folders are fetched and chipped (FIX 5) */
  showExcluded: boolean;
  /** parallel thumbnail decoders (1–16, applied by the engine on next request) */
  thumbWorkers: number;
  /** accent preset hex (Settings › Appearance, FIX 4a) */
  accent: string;
  /** grid density preset (FIX 4b) */
  gridDensity: GridDensity;
  loaded: boolean;
  load: () => Promise<void>;
  setVideoScrubRate: (rate: number) => Promise<void>;
  setHoverCaptions: (on: boolean) => Promise<void>;
  setVideoAutoplay: (on: boolean) => Promise<void>;
  setSwipeNavigate: (on: boolean) => Promise<void>;
  setPillAlign: (align: PillAlign) => Promise<void>;
  setShowFps: (on: boolean) => Promise<void>;
  setShowExcluded: (on: boolean) => Promise<void>;
  setThumbWorkers: (count: number) => Promise<void>;
  setAccent: (hex: string) => Promise<void>;
  setGridDensity: (density: GridDensity) => Promise<void>;
}

export const useAppSettings = create<AppSettingsState>((set) => ({
  videoScrubRate: DEFAULT_SCRUB_RATE,
  hoverCaptions: true,
  videoAutoplay: true,
  swipeNavigate: true,
  pillAlign: DEFAULT_PILL_ALIGN,
  showFps: false,
  showExcluded: false,
  thumbWorkers: DEFAULT_THUMB_WORKERS,
  accent: DEFAULT_ACCENT,
  gridDensity: DEFAULT_DENSITY,
  loaded: false,

  load: async () => {
    try {
      const db = await getDb();
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM settings WHERE key IN ('video_scrub_rate', 'hover_captions', 'video_autoplay', 'viewer_swipe', 'viewer_pill_align', 'perf_show_fps', 'show_excluded', 'thumb_workers', 'accent', 'grid_density')",
      );
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const raw = Number(byKey.get(SCRUB_RATE_KEY));
      set({
        videoScrubRate:
          Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SCRUB_RATE,
        // absent = first run: captions are ON by default (F2)
        hoverCaptions: byKey.get(HOVER_CAPTIONS_KEY) !== "false",
        videoAutoplay: byKey.get(VIDEO_AUTOPLAY_KEY) !== "false",
        swipeNavigate: byKey.get(SWIPE_NAVIGATE_KEY) !== "false",
        pillAlign: readPillAlign(byKey.get(PILL_ALIGN_KEY)),
        showFps: byKey.get(SHOW_FPS_KEY) === "true",
        showExcluded: byKey.get(SHOW_EXCLUDED_KEY) === "true",
        thumbWorkers: readWorkers(byKey.get(THUMB_WORKERS_KEY)),
        accent: readAccent(byKey.get(ACCENT_SETTING_KEY)),
        gridDensity: readDensity(byKey.get(DENSITY_KEY)),
        loaded: true,
      });
      // the stored accent wins over the pre-paint cache
      applyAccent(readAccent(byKey.get(ACCENT_SETTING_KEY)));
    } catch (e) {
      console.error("settings load failed", e);
      set({ loaded: true });
    }
  },

  setVideoScrubRate: async (rate) => {
    set({ videoScrubRate: rate }); // optimistic: the grid reacts instantly
    try {
      // through the single writer (S1.12), never a private pool connection
      await writeSetting(SCRUB_RATE_KEY, String(rate));
      toast.success(i18n.t("settings.scrub_saved", { rate }));
    } catch (e) {
      console.error("settings save failed", e);
      toast.error(i18n.t("settings.scrub_failed"));
    }
  },

  setHoverCaptions: async (on) => {
    set({ hoverCaptions: on }); // optimistic: the grid reacts instantly
    try {
      await writeSetting(HOVER_CAPTIONS_KEY, String(on));
    } catch (e) {
      console.error("hover captions save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setVideoAutoplay: async (on) => {
    set({ videoAutoplay: on }); // optimistic: the player reacts instantly
    try {
      await writeSetting(VIDEO_AUTOPLAY_KEY, String(on));
    } catch (e) {
      console.error("autoplay setting save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setSwipeNavigate: async (on) => {
    set({ swipeNavigate: on }); // optimistic: the lightbox reacts instantly
    try {
      await writeSetting(SWIPE_NAVIGATE_KEY, String(on));
    } catch (e) {
      console.error("swipe setting save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setPillAlign: async (pillAlign: PillAlign) => {
    set({ pillAlign }); // optimistic: the open viewer moves immediately
    try {
      await writeSetting(PILL_ALIGN_KEY, pillAlign);
    } catch (e) {
      console.error("pill align save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setShowFps: async (showFps) => {
    set({ showFps });
    try {
      await writeSetting(SHOW_FPS_KEY, String(showFps));
    } catch (e) {
      console.error("fps setting save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },
  setShowExcluded: async (showExcluded) => {
    set({ showExcluded });
    try {
      await writeSetting(SHOW_EXCLUDED_KEY, String(showExcluded));
    } catch (e) {
      console.error("show excluded save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setThumbWorkers: async (thumbWorkers) => {
    set({ thumbWorkers });
    try {
      // the Rust engine re-reads `thumb_workers` per request, so this takes
      // effect on the next thumbnail without a restart
      await writeSetting(THUMB_WORKERS_KEY, String(thumbWorkers));
      toast.success(i18n.t("settings.workers_saved", { count: thumbWorkers }));
    } catch (e) {
      console.error("thumb workers save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setAccent: async (accent) => {
    set({ accent }); // optimistic: CSS vars repaint before the row lands
    applyAccent(accent);
    try {
      await writeSetting(ACCENT_SETTING_KEY, accent);
    } catch (e) {
      console.error("accent save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setGridDensity: async (gridDensity) => {
    set({ gridDensity }); // optimistic: the grid re-lays out live
    try {
      await writeSetting(DENSITY_KEY, gridDensity);
    } catch (e) {
      console.error("grid density save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },
}));

/** Anything unexpected in the stored accent falls back to the default. */
function readAccent(raw: string | undefined): string {
  return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw : DEFAULT_ACCENT;
}

/** Unknown density values fall back to the medium preset. */
function readDensity(raw: string | undefined): GridDensity {
  return raw === "comfort" || raw === "compact" ? raw : DEFAULT_DENSITY;
}

/** Anything unexpected in the stored value falls back to the centre. */
function readPillAlign(raw: string | undefined): PillAlign {
  return raw === "left" || raw === "right" ? raw : DEFAULT_PILL_ALIGN;
}

/** Unknown or out-of-range worker counts fall back to the default (Rust clamps too). */
function readWorkers(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 16 ? n : DEFAULT_THUMB_WORKERS;
}
