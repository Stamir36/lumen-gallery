/**
 * Accent presets (Settings › Appearance, FIX 4a).
 *
 * The accent is a runtime CSS variable set on `:root` — every accent anchor in
 * the UI reads `var(--accent)` / `var(--accent-soft)` / `var(--accent-strong)`,
 * so switching a swatch repaints instantly. SQLite is the source of truth; a
 * localStorage copy exists ONLY so the stored colour can be applied before the
 * first paint (otherwise a violet theme would flash azure on every launch).
 */
export interface AccentPreset {
  id: string;
  hex: string;
  /** i18n key for the swatch tooltip */
  labelKey: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "azure", hex: "#6EC1FF", labelKey: "settings.accent_azure" },
  { id: "violet", hex: "#B39DFF", labelKey: "settings.accent_violet" },
  { id: "mint", hex: "#7FE0C3", labelKey: "settings.accent_mint" },
  { id: "amber", hex: "#FFC46B", labelKey: "settings.accent_amber" },
  { id: "rose", hex: "#FF8FA3", labelKey: "settings.accent_rose" },
];

export const ACCENT_KEY = "accent";
export const DEFAULT_ACCENT = ACCENTS[0].hex;
/** paint-only cache key (never the source of truth) */
export const ACCENT_CACHE_KEY = "lumen.accent";

/** `#RRGGBB` → `rgba(r, g, b, a)`; anything unexpected falls back to the input. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Writes the accent triple on `:root`. Safe to call before React mounts. */
export function applyAccent(hex: string): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-soft", hexToRgba(hex, 0.16));
  root.style.setProperty("--accent-strong", hexToRgba(hex, 0.4));
  try {
    localStorage.setItem(ACCENT_CACHE_KEY, hex);
  } catch {
    // private mode / storage disabled: the cache is optional by design
  }
}

/** Synchronous pre-paint pass from the cache (default when nothing cached). */
export function applyCachedAccent(): void {
  let hex = DEFAULT_ACCENT;
  try {
    hex = localStorage.getItem(ACCENT_CACHE_KEY) || DEFAULT_ACCENT;
  } catch {
    hex = DEFAULT_ACCENT;
  }
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-soft", hexToRgba(hex, 0.16));
  root.style.setProperty("--accent-strong", hexToRgba(hex, 0.4));
}

/** True when `hex` matches one of the presets (used for the active ring). */
export function isPresetAccent(hex: string): boolean {
  return ACCENTS.some((a) => a.hex.toLowerCase() === hex.toLowerCase());
}