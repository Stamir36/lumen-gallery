/**
 * Dev utility: verifies the newest migrations + write statements against a COPY
 * of the real database (the original is never opened for writing).
 *
 * Why a copy: an "it works on my machine" claim about SQL is worth nothing. This
 * runs the exact statements the Rust side runs — watch_progress upsert, folder
 * exclusion/restore prefix predicate, the visibility predicate every query uses —
 * on real rows and prints what actually happened.
 *
 * Usage:  node --experimental-sqlite scripts/db-schema-check.cjs [path\to\lumen.db]
 * Default path: %APPDATA%\app.lumen.gallery\lumen.db
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const source =
  process.argv[2] ??
  path.join(process.env.APPDATA ?? "", "app.lumen.gallery", "lumen.db");

if (!fs.existsSync(source)) {
  console.error(`database not found: ${source}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-schema-"));
const copy = path.join(tmp, "lumen.db");
fs.copyFileSync(source, copy);
console.log(`source : ${source}`);
console.log(`copy   : ${copy}\n`);

const db = new DatabaseSync(copy);
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// ---------------------------------------------------------------- migrations
// MIGRATION_V7 (db.rs): v1 had already created watch_progress(posms_s); v6's
// CREATE TABLE IF NOT EXISTS therefore never added the ms columns.
db.exec(`
DROP TABLE IF EXISTS watch_progress;
CREATE TABLE watch_progress (
  media_id    INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);`);

// MIGRATION_V8 (db.rs): folder exclusions
db.exec(`
ALTER TABLE media ADD COLUMN excluded BOOLEAN NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_media_excluded ON media(excluded);
CREATE TABLE IF NOT EXISTS excluded_folders (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id  INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  path     TEXT    NOT NULL,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (root_id, path)
);`);

// ------------------------------------------------------------- watch progress
const media = db.prepare("SELECT id, root_id, path FROM media ORDER BY mtime DESC").all();
if (media.length === 0) {
  console.error("no media rows in this database");
  process.exit(1);
}
const UPSERT_PROGRESS = `INSERT INTO watch_progress (media_id, position_ms, duration_ms, updated_at)
   VALUES (?, ?, ?, unixepoch())
   ON CONFLICT(media_id) DO UPDATE SET
     position_ms = excluded.position_ms,
     duration_ms = excluded.duration_ms,
     updated_at  = excluded.updated_at`;
db.prepare(UPSERT_PROGRESS).run(media[0].id, 754000, 5400000);
db.prepare(UPSERT_PROGRESS).run(media[0].id, 900000, 5400000);
const progress = db
  .prepare("SELECT media_id, position_ms, duration_ms FROM watch_progress WHERE media_id IN (?)")
  .get(media[0].id);
check(
  "watch_progress upsert + read",
  progress.position_ms === 900000,
  `position_ms=${progress.position_ms}`,
);

// ------------------------------------------------------------ folder exclusion
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, "");
const counts = new Map();
for (const row of media) {
  const dir = dirOf(row.path);
  counts.set(dir, (counts.get(dir) ?? 0) + 1);
}
const [dir, inside] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`folder  : ${dir} (${inside} files)\n`);

// Anonymous placeholders on purpose: node:sqlite only binds `?`, not `?N`
// (sqlx, which runs the real statement, understands `?N`). The SQL itself is
// character-for-character the same as the Rust statement.
const SET_EXCLUDED = `UPDATE media SET excluded = ?
  WHERE root_id = ?
    AND (path = ? OR substr(path, 1, length(?) + 1) IN (? || '\\', ? || '/'))`;
const excludeArgs = (flag, rootId, dir) => [flag, rootId, dir, dir, dir, dir];
const visible = () =>
  db.prepare("SELECT COUNT(*) AS c FROM media WHERE trashed = 0 AND excluded = 0").get().c;

const before = visible();
const flagged = db.prepare(SET_EXCLUDED).run(...excludeArgs(1, media[0].root_id, dir)).changes;
check("exclude flags the subtree", flagged === inside, `${flagged} of ${inside} rows`);
check("queries hide them", visible() === before - inside, `${before} → ${visible()}`);

db.prepare("INSERT OR IGNORE INTO excluded_folders (root_id, path) VALUES (?, ?)").run(
  media[0].root_id,
  dir,
);
const hidden = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM media m
              WHERE m.root_id = e.root_id AND m.excluded = 1
                AND (m.path = e.path
                     OR substr(m.path, 1, length(e.path) + 1) IN (e.path || '\\', e.path || '/')))
            AS hidden
       FROM excluded_folders e`,
  )
  .get().hidden;
check("list_excluded reports the hidden count", hidden === inside, `${hidden}`);

db.prepare("DELETE FROM excluded_folders WHERE root_id = ? AND path = ?").run(
  media[0].root_id,
  dir,
);
const restored = db.prepare(SET_EXCLUDED).run(...excludeArgs(0, media[0].root_id, dir)).changes;
check("restore clears the flags", restored === inside && visible() === before, `${restored}`);

// a folder name that is a PREFIX of this one must not be touched
const sibling = `${dir} 2`;
db.prepare(SET_EXCLUDED).run(...excludeArgs(1, media[0].root_id, dir));
db.prepare(SET_EXCLUDED).run(...excludeArgs(1, media[0].root_id, sibling));
const afterSibling = db
  .prepare("SELECT COUNT(*) AS c FROM media WHERE excluded = 1")
  .get().c;
check(
  "prefix boundary is exact",
  afterSibling === inside,
  `"${sibling}" matched nothing extra (${afterSibling} rows flagged)`,
);

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("\ndone");
