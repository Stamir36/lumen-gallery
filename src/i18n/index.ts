import i18n from "i18next";
import { initReactI18next } from "react-i18next";
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
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [LANG_KEY, lng],
  );
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

export async function writeSetting(key: string, value: string) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Cursor pointer preference (default OFF). */
export const CURSOR_KEY = "ui.cursor_pointer";
export async function applyCursorPreference() {
  const v = await readSetting(CURSOR_KEY);
  document.documentElement.classList.toggle("cursor-pointer", v === "true");
}
export async function setCursorPointer(on: boolean) {
  document.documentElement.classList.toggle("cursor-pointer", on);
  await writeSetting(CURSOR_KEY, String(on));
}

export default i18n;