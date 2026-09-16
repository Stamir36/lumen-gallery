import Database from "@tauri-apps/plugin-sql";

/** SQLite file loaded through tauri-plugin-sql (migrations run on load). */
export const DB_URL = "sqlite:lumen.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}