//! LUMEN — SQLite migrations (v1) and shared SQL constants.

/// Extension whitelist default (stored in `settings`, overridable later).
pub const DEFAULT_EXTENSIONS: &str =
    "jpg,jpeg,png,gif,webp,avif,bmp,mp4,mkv,webm,mov,m4v";

pub const IMAGE_EXTENSIONS: &[&str] =
    &["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];

/// SQLite database URL. MUST stay in sync with src/lib/db.ts — tauri-plugin-sql
/// keys its DbInstances map by this exact string.
/// NOTE: plugin's path_mapper strips everything after ':' and treats the rest as
/// a plain file path, so URL query params (pragmas) are NOT supported here.
/// Pragmas are enforced at runtime instead (see lib.rs setup hook).
pub const DB_URL: &str = "sqlite:lumen.db";

pub const MIGRATION_V1: &str = r#"
-- roots: user-added library roots (folders / drives)
CREATE TABLE IF NOT EXISTS roots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  path      TEXT    NOT NULL UNIQUE,
  kind      TEXT    NOT NULL DEFAULT 'fixed',   -- fixed | removable | folder
  label     TEXT    NOT NULL DEFAULT '',
  added_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- media: one row per media file
CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id     INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL UNIQUE,
  kind        TEXT    NOT NULL,                 -- image | video
  ext         TEXT    NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  mtime       INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  favorite    INTEGER NOT NULL DEFAULT 0,       -- bool
  trashed     INTEGER NOT NULL DEFAULT 0,       -- bool (DB flag only, v1)
  added_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_media_root    ON media(root_id);
CREATE INDEX IF NOT EXISTS idx_media_mtime   ON media(mtime DESC);
CREATE INDEX IF NOT EXISTS idx_media_kind    ON media(kind);
CREATE INDEX IF NOT EXISTS idx_media_trashed ON media(trashed);

-- albums: user collections (DB-only, no file copies)
CREATE TABLE IF NOT EXISTS albums (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS album_items (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id  INTEGER NOT NULL REFERENCES media(id)  ON DELETE CASCADE,
  PRIMARY KEY (album_id, media_id)
);

-- watch_progress: video resume positions
CREATE TABLE IF NOT EXISTS watch_progress (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position_s REAL    NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- settings: key/value
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('extensions', 'jpg,jpeg,png,gif,webp,avif,bmp,mp4,mkv,webm,mov,m4v');
INSERT OR IGNORE INTO settings(key, value) VALUES ('external_player', '');
"#;

/// v2: offline flag on media (ejected/unreadable root — rows are kept, UI
/// contract: offline media render as gray tiles later).
pub const MIGRATION_V2: &str = r#"
ALTER TABLE media ADD COLUMN offline BOOLEAN NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_media_offline ON media(offline);
"#;

/// v3: thumbnail cache columns (lazy generation, mtime-keyed freshness).
pub const MIGRATION_V3: &str = r#"
ALTER TABLE media ADD COLUMN thumb_path TEXT;
ALTER TABLE media ADD COLUMN thumb_mtime INTEGER;
ALTER TABLE media ADD COLUMN dominant_color TEXT;
CREATE INDEX IF NOT EXISTS idx_media_thumb_path ON media(thumb_path);
"#;

/// v4: permanent thumbnail failure flag.
/// Corrupt/mislabeled files (e.g. a `.png` that is not a PNG) must not be
/// retried on every restart — one warn per file, then a "no preview" tile.
/// `thumb_mtime` records the mtime that failed, so a changed file retries.
pub const MIGRATION_V4: &str = r#"
ALTER TABLE media ADD COLUMN thumb_error BOOLEAN NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_media_thumb_error ON media(thumb_error);
"#;

/// v6: watch progress (STEP 2). Resume playback: the player writes every ~5s and
/// on close, so re-opening a film offers "continue 12:34" instead of starting at
/// zero. Keyed by media id, cascading with the media row.
pub const MIGRATION_V6: &str = r#"
CREATE TABLE IF NOT EXISTS watch_progress (
  media_id    INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
"#;

/// v7: watch_progress rebuilt in MILLISECONDS.
///
/// v6 declared the table with `CREATE TABLE IF NOT EXISTS`, but v1 had already
/// created `watch_progress(media_id, position_s, updated_at)` — so on every
/// existing database the ms columns never appeared and every progress save died
/// with "table watch_progress has no column named position_ms". The v1 columns
/// were never read by any code path (the reader always asked for position_ms),
/// so the table is rebuilt from scratch instead of carrying dead columns along.
pub const MIGRATION_V7: &str = r#"
DROP TABLE IF EXISTS watch_progress;
CREATE TABLE watch_progress (
  media_id    INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
"#;

/// v5: versioned thumbnail cache (S1.4). `thumb_mtime` alone was not enough — a
/// file replaced with an identical mtime kept serving a stale thumbnail, and a
/// previously failed row was only retried when the mtime moved. Validity is now
/// keyed by the (mtime, size) pair that the thumbnail was rendered from.
pub const MIGRATION_V5: &str = r#"
ALTER TABLE media ADD COLUMN thumb_size INTEGER;
"#;
