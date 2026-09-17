import { create } from "zustand";
import { toast } from "sonner";
import i18n, { writeSetting } from "@/i18n";
import { getDb } from "@/lib/db";

/**
 * User-facing settings that the UI reacts to live, persisted in the `settings`
 * key/value table (the same place the Rust side reads `extensions` from).
 */
export const SCRUB_RATE_KEY = "video_scrub_rate";
/** Filename caption over the hover gradient (Settings › Appearance), default ON. */
export const HOVER_CAPTIONS_KEY = "hover_captions";
/** Swipe left/right to walk the photo queue in the lightbox, default ON. */
export const SWIPE_NAVIGATE_KEY = "viewer_swipe";
/** Where the floating control pill sits in the viewers (center | left | right). */
export const PILL_ALIGN_KEY = "viewer_pill_align";

export type PillAlign = "center" | "left" | "right";
export const DEFAULT_PILL_ALIGN: PillAlign = "center";
/** Live frame-rate chip in the status line (Settings › Appearance), default OFF. */
export const SHOW_FPS_KEY = "perf_show_fps";

/** Hover scrub speed presets. 6× (the original) felt like a fast-forward. */
export const SCRUB_RATES = [1.5, 3, 6, 9] as const;
export const DEFAULT_SCRUB_RATE = 3;

export const WATCH_PROGRESS_PREFIX = "watch:";

interface AppSettingsState {
  /** playback rate used by the grid's hover preview */
  videoScrubRate: number;
  /** filename caption on card hover (F2) */
  hoverCaptions: boolean;
  /** horizontal swipe walks the photo queue (Settings › Appearance) */
  swipeNavigate: boolean;
  /** where the viewer control pill floats (Settings › Appearance) */
  pillAlign: PillAlign;
  /** mono FPS / worst-frame chip in the status line */
  showFps: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setVideoScrubRate: (rate: number) => Promise<void>;
  setHoverCaptions: (on: boolean) => Promise<void>;
  setSwipeNavigate: (on: boolean) => Promise<void>;
  setPillAlign: (align: PillAlign) => Promise<void>;
  setShowFps: (on: boolean) => Promise<void>;
}

export const useAppSettings = create<AppSettingsState>((set) => ({
  videoScrubRate: DEFAULT_SCRUB_RATE,
  hoverCaptions: true,
  swipeNavigate: true,
  pillAlign: DEFAULT_PILL_ALIGN,
  showFps: false,
  loaded: false,

  load: async () => {
    try {
      const db = await getDb();
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM settings WHERE key IN ('video_scrub_rate', 'hover_captions', 'viewer_swipe', 'viewer_pill_align', 'perf_show_fps')",
      );
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const raw = Number(byKey.get(SCRUB_RATE_KEY));
      set({
        videoScrubRate:
          Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SCRUB_RATE,
        // absent = first run: captions are ON by default (F2)
        hoverCaptions: byKey.get(HOVER_CAPTIONS_KEY) !== "false",
        swipeNavigate: byKey.get(SWIPE_NAVIGATE_KEY) !== "false",
        pillAlign: readPillAlign(byKey.get(PILL_ALIGN_KEY)),
        showFps: byKey.get(SHOW_FPS_KEY) === "true",
        loaded: true,
      });
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

  setSwipeNavigate: async (on) => {
    set({ swipeNavigate: on }); // optimistic: the lightbox reacts instantly
    try {
      await writeSetting(SWIPE_NAVIGATE_KEY, String(on));
    } catch (e) {
      console.error("swipe setting save failed", e);
      toast.error(i18n.t("errors.action_failed"));
    }
  },

  setPillAlign: async (pillAlign) => {
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
}));

/** Anything unexpected in the stored value falls back to the centre. */
function readPillAlign(raw: string | undefined): PillAlign {
  return raw === "left" || raw === "right" ? raw : DEFAULT_PILL_ALIGN;
}
