import { create } from "zustand";
import { toast } from "sonner";
import i18n, { writeSetting } from "@/i18n";
import { getDb } from "@/lib/db";
import { ACCENT_KEY as ACCENT_SETTING_KEY, DEFAULT_ACCENT, applyAccent } from "@/lib/accent";
import { applyVideoFilter } from "@/lib/colorCorrection";

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

/** P7 F4 — global video color correction (applies to every video surface). */
export const VIDEO_SATURATION_KEY = "video_saturation";
export const VIDEO_SHARPNESS_KEY = "video_sharpness";
/**
 * Loopback media server for video playback. ON by default: with the
 * multi-threaded worker pool it streams fine and keeps frames canvas-clean
 * (frame screenshots, VR dome). Opt-out is "direct playback" — the asset
 * protocol serves the file without the server hop.
 */
/** Direct playback (Settings › Playback): bypass the media server, default OFF. */
export const DIRECT_PLAYBACK_KEY = "direct_playback";
/** C1 — collage tile fit: contain (default) | cover (fill the tile). */
export const COLLAGE_FIT_KEY = "collage_fit";
export type CollageFit = "contain" | "cover";

/**
 * P4 — main-screen layout (Settings › Appearance).
 *  - `classic`: sidebar + one library bar (default);
 *  - `rail`:    full-width header + permanent 64px icon rail + chips row.
 * The main screen ONLY: the viewer, player and collage are unaffected.
 */
export const MAIN_LAYOUT_KEY = "appearance.main_layout";
export type MainLayout = "classic" | "rail";
export const DEFAULT_MAIN_LAYOUT: MainLayout = "classic";

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
  /** global video saturation multiplier (1 = neutral, P7 F4) */
  videoSaturation: number;
  /** global video unsharp strength 0..1 (0 = off, P7 F4) */
  videoSharpness: number;
  /** collage tiles: contain or cover (C1, global default) */
  collageFit: CollageFit;
  /** stream video DIRECTLY via the asset protocol (off = loopback media server) */
  directPlayback: boolean;
  /** main-screen layout: classic sidebar vs permanent icon rail */
  mainLayout: MainLayout;
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
  setVideoSaturation: (v: number) => Promise<void>;
  setVideoSharpness: (v: number) => Promise<void>;
  setCollageFit: (fit: CollageFit) => Promise<void>;
  setDirectPlayback: (on: boolean) => Promise<void>;
  setMainLayout: (layout: MainLayout) => Promise<void>;
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
  videoSaturation: 1,
  videoSharpness: 0,
  collageFit: "contain",
  directPlayback: false,
  mainLayout: DEFAULT_MAIN_LAYOUT,
  loaded: false,

  load: async () => {
    try {
      const db = await getDb();
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM settings WHERE key IN ('video_scrub_rate', 'hover_captions', 'video_autoplay', 'viewer_swipe', 'viewer_pill_align', 'perf_show_fps', 'show_excluded', 'thumb_workers', 'accent', 'grid_density', 'video_saturation', 'video_sharpness', 'collage_fit', 'direct_playback', 'appearance.main_layout')",
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
        videoSaturation: readFilterNumber(byKey.get(VIDEO_SATURATION_KEY), 1, 0.5, 2),
        videoSharpness: readFilterNumber(byKey.get(VIDEO_SHARPNESS_KEY), 0, 0, 1),
        collageFit: byKey.get(COLLAGE_FIT_KEY) === "cover" ? "cover" : "contain",
        // ABSENT = OFF: the media server is the default source
        directPlayback: byKey.get(DIRECT_PLAYBACK_KEY) === "true",
        // ABSENT = classic: the rail is an opt-in layout
        mainLayout: byKey.get(MAIN_LAYOUT_KEY) === "rail" ? "rail" : DEFAULT_MAIN_LAYOUT,
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

  setVideoSaturation: async (v) => {
    set({ videoSaturation: v }); // optimistic: the filter updates on input
    applyVideoFilter(v, useAppSettings.getState().videoSharpness);
    try {
      await writeSetting(VIDEO_SATURATION_KEY, String(v));
    } catch (e) {
      console.error("video saturation save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setVideoSharpness: async (v) => {
    set({ videoSharpness: v }); // optimistic
    applyVideoFilter(useAppSettings.getState().videoSaturation, v);
    try {
      await writeSetting(VIDEO_SHARPNESS_KEY, String(v));
    } catch (e) {
      console.error("video sharpness save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setCollageFit: async (collageFit) => {
    set({ collageFit }); // optimistic: open collage restyles instantly
    try {
      await writeSetting(COLLAGE_FIT_KEY, collageFit);
    } catch (e) {
      console.error("collage fit save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setDirectPlayback: async (directPlayback) => {
    set({ directPlayback }); // optimistic: the next opened video follows at once
    try {
      await writeSetting(DIRECT_PLAYBACK_KEY, String(directPlayback));
    } catch (e) {
      console.error("direct playback setting save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setMainLayout: async (mainLayout) => {
    set({ mainLayout }); // optimistic: the shell re-renders live, no reload
    try {
      await writeSetting(MAIN_LAYOUT_KEY, mainLayout);
    } catch (e) {
      console.error("main layout save failed", e);
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

/** P7 F4: clamp + parse a persisted filter value; unexpected → fallback. */
function readFilterNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
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
