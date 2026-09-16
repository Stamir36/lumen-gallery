//! Scan core: recursive walk, whitelist filtering, hidden/system skipping,
//! dedupe by (path, mtime, size), SQLite upsert, progress events, fs watcher.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::IMAGE_EXTENSIONS;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub root_id: i64,
    pub phase: String, // walk | finalize
    pub done: u64,
    pub total: u64,
    pub current_path: String,
    pub added: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRow {
    pub id: i64,
    pub root_id: i64,
    pub path: String,
    pub kind: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub favorite: bool,
    pub trashed: bool,
    pub added_at: i64,
}

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A root counts as readable only if it exists, is a dir, and listdir succeeds
/// (catches ejected drives where the mount point may still be a stub).
fn root_is_readable(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    std::fs::read_dir(path).is_ok()
}

/// Windows: skip FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM.
fn is_hidden_or_system(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        let attrs = meta.file_attributes();
        attrs & HIDDEN != 0 || attrs & SYSTEM != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

pub fn kind_for_ext(ext: &str) -> &'static str {
    if IMAGE_EXTENSIONS.contains(&ext) {
        "image"
    } else {
        "video"
    }
}

/// Reads the extension whitelist from settings (fallback: DEFAULT_EXTENSIONS).
pub async fn whitelist(pool: &SqlitePool) -> HashSet<String> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'extensions'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

    value
        .unwrap_or_else(|| crate::db::DEFAULT_EXTENSIONS.to_string())
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Cheap dedupe check: does (path, mtime, size) already exist unchanged?
async fn is_unchanged(pool: &SqlitePool, path: &str, mtime: i64, size: i64) -> bool {
    let row = sqlx::query("SELECT mtime, size FROM media WHERE path = ?1")
        .bind(path)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r.get::<i64, _>("mtime") == mtime && r.get::<i64, _>("size") == size,
        None => false,
    }
}

async fn upsert(
    pool: &SqlitePool,
    root_id: i64,
    path: &str,
    kind: &str,
    ext: &str,
    size: i64,
    mtime: i64,
) -> bool {
    sqlx::query(
        r#"INSERT INTO media (root_id, path, kind, ext, size, mtime)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(path) DO UPDATE SET
             root_id = excluded.root_id,
             kind    = excluded.kind,
             ext     = excluded.ext,
             size    = excluded.size,
             mtime   = excluded.mtime"#,
    )
    .bind(root_id)
    .bind(path)
    .bind(kind)
    .bind(ext)
    .bind(size)
    .bind(mtime)
    .execute(pool)
    .await
    .is_ok()
}

fn emit_progress(
    app: &AppHandle,
    root_id: i64,
    phase: &str,
    done: u64,
    total: u64,
    current_path: String,
    added: u64,
) {
    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            root_id,
            phase: phase.to_string(),
            done,
            total,
            current_path,
            added,
        },
    );
}

/// Walks `root` recursively, upserts media rows, emits `scan-progress`.
/// Returns (files_seen, media_added_or_updated).
pub async fn scan_root(
    app: &AppHandle,
    pool: &SqlitePool,
    root_id: i64,
    root_path: &Path,
) -> Result<(u64, u64), String> {
    let allowed = whitelist(pool).await;

    // Pass 1: collect candidate files (fast, no DB round-trips).
    let mut candidates: Vec<PathBuf> = Vec::new();
    let walker = WalkDir::new(root_path).follow_links(false).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.depth() == 0 {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        if let Ok(meta) = entry.metadata() {
            if is_hidden_or_system(&meta) {
                continue; // skip hidden/system files AND dirs (no descent)
            }
        }
        if !is_dir && entry.file_type().is_file() {
            let ext = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if !ext.is_empty() && allowed.contains(&ext) {
                candidates.push(entry.path().to_path_buf());
            }
        }
    }

    let total = candidates.len() as u64;
    let mut done = 0u64;
    let mut added = 0u64;

    emit_progress(app, root_id, "walk", 0, total, String::new(), 0);

    for path in &candidates {
        done += 1;
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue, // vanished mid-scan
        };
        let mtime = mtime_secs(&meta);
        let size = meta.len() as i64;
        let path_str = path.to_string_lossy().to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase();

        if !is_unchanged(pool, &path_str, mtime, size).await
            && upsert(pool, root_id, &path_str, kind_for_ext(&ext), &ext, size, mtime).await
        {
            added += 1;
        }

        if done % 25 == 0 || done == total {
            emit_progress(app, root_id, "walk", done, total, path_str, added);
        }
    }

    // Pass 2: drop rows whose files no longer exist under this root.
    // NEVER delete when the root itself is gone/unreadable (ejected drive,
    // temporarily unmounted volume): flag media offline instead so a flaky
    // mount can never wipe the library (SPEC §3).
    if !root_is_readable(root_path) {
        log::warn!(
            "root {:?} is offline (ejected/unreadable) — skipping row cleanup, flagging media offline",
            root_path
        );
        let _ = sqlx::query("UPDATE media SET offline = 1 WHERE root_id = ?1 AND offline = 0")
            .bind(root_id)
            .execute(pool)
            .await;
        let _ = app.emit(
            "root-offline",
            serde_json::json!({ "rootId": root_id, "path": root_path.to_string_lossy() }),
        );
        return Ok((done, added));
    }

    let existing: Vec<String> = sqlx::query_scalar("SELECT path FROM media WHERE root_id = ?1")
        .bind(root_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for path in existing {
        if !Path::new(&path).exists() {
            let _ = sqlx::query("DELETE FROM media WHERE path = ?1")
                .bind(&path)
                .execute(pool)
                .await;
        }
    }

    // Successful scan with a readable root: clear stale offline flags.
    let _ = sqlx::query("UPDATE media SET offline = 0 WHERE root_id = ?1 AND offline = 1")
        .bind(root_id)
        .execute(pool)
        .await;

    emit_progress(app, root_id, "finalize", done, total, String::new(), added);
    Ok((done, added))
}

/// Background watcher: debounce 2s, then incremental rescan of the root.
pub fn spawn_watcher(app: AppHandle, pool: SqlitePool, root_id: i64, root_path: PathBuf) {
    use notify::{RecursiveMode, Watcher};

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<()>();

        let mut watcher = match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("watcher init failed for {:?}: {e}", root_path);
                return;
            }
        };

        if let Err(e) = watcher.watch(&root_path, RecursiveMode::Recursive) {
            log::warn!("watch failed for {:?}: {e}", root_path);
            return;
        }

        let debounce = Duration::from_secs(2);
        loop {
            if rx.recv().is_err() {
                return; // app shutting down
            }
            // coalesce further filesystem events for 2s
            while rx.recv_timeout(debounce).is_ok() {}

            let app2 = app.clone();
            let pool2 = pool.clone();
            let path2 = root_path.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = scan_root(&app2, &pool2, root_id, &path2).await {
                    log::warn!("incremental rescan failed: {e}");
                }
            });
        }
    });
}
