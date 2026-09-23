import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { tauriAvailable } from "@/lib/assets";
import en from "./en.json";
import ru from "./ru.json";

export const LANG_KEY = "lang";
export type Lang = "en" | "ru";

/** Future languages = one array entry here. */
export const LOCALES: { code: Lang; nativeName: string }[] = [
  { code: "en", nativeName: "English" },
  { code: "ru", nativeName: "Русский" },
];

/** System detection: ru-RU / ru → 'ru', everything else → 'en'. */
function detectLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("ru") ? "ru" : "en";
}

/**
 * Boots i18next. `saved` comes from the SQLite settings table (key='lang')
 * and wins over system detection.
 */
export async function initI18n(saved?: string | null) {
  const lng: Lang =
    saved === "ru" || saved === "en" ? (saved as Lang) : detectLang();

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ru: { translation: ru },
      },
      lng,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }

  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
  return lng;
}

/** Persists the chosen language in SQLite (settings.kv). */
export async function persistLang(lng: Lang) {
  await writeSetting(LANG_KEY, lng);
}

/** Reads the saved language, if any. */
export async function readSavedLang(): Promise<Lang | null> {
  try {
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = ?1",
      [LANG_KEY],
    );
    const value = rows[0]?.value;
    return value === "ru" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

/** Generic settings kv read/write helpers (frontend-owned keys). */
export async function readSetting(key: string): Promise<string | null> {
  try {
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = ?1",
      [key],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The ONE write path for frontend-owned settings keys (S1.12).
 *
 * In the app it goes through `db_exec`, i.e. the Rust single-writer task: a
 * settings write used to open its own pool connection and contend with the
 * thumbnail batch transactions. The sql-plugin fallback only serves the browser
 * QA route, where there is no IPC at all.
 */
export async function writeSetting(key: string, value: string) {
  const sql =
    "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  if (tauriAvailable()) {
    await invoke("db_exec", { sql, params: [key, value] });
    return;
  }
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute(sql, [key, value]);
}

/** Cursor pointer preference (default OFF). */
export const CURSOR_KEY = "ui.cursor_pointer";
export async function applyCursorPreference() {
  const v = await readSetting(CURSOR_KEY);
  // data-attribute, NOT a class: `.cursor-pointer` collides with the Tailwind
  // utility of the same name, and cursor inherits — the whole window pointed
  // (BUGS 29.09).
  document.documentElement.toggleAttribute("data-cursor-pointer", v === "true");
}
export async function setCursorPointer(on: boolean) {
  document.documentElement.toggleAttribute("data-cursor-pointer", on);
  await writeSetting(CURSOR_KEY, String(on));
}

/** Custom LUMEN cursor (default OFF): the drawn arrow replaces the system one. */
export const CUSTOM_CURSOR_KEY = "ui.custom_cursor";
export async function applyCustomCursorPreference() {
  const v = await readSetting(CUSTOM_CURSOR_KEY);
  document.documentElement.toggleAttribute("data-custom-cursor", v === "true");
}
export async function setCustomCursor(on: boolean) {
  document.documentElement.toggleAttribute("data-custom-cursor", on);
  await writeSetting(CUSTOM_CURSOR_KEY, String(on));
}

export default i18n;