//! Scan core: recursive walk, whitelist filtering, hidden/system skipping,
//! dedupe by (path, mtime, size), SQLite upsert, progress events, fs watcher.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use sqlx::{Connection as _, SqlitePool};
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

/// Batched upsert: chunks of 500 rows per transaction, conditional on a real
/// change (missing row, or mtime/size differ) so rescans only count writes.
const UPSERT_CHUNK: usize = 500;

async fn upsert_chunk(
    tx: &mut sqlx::SqliteConnection,
    rows: &[Candidate],
) -> Result<u64, String> {
    let mut changed = 0u64;
    for c in rows {
        let res = sqlx::query(
            r#"INSERT INTO media (root_id, path, kind, ext, size, mtime)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               ON CONFLICT(path) DO UPDATE SET
                 root_id = excluded.root_id,
                 kind    = excluded.kind,
                 ext     = excluded.ext,
                 size    = excluded.size,
                 mtime   = excluded.mtime
               WHERE media.mtime IS NOT ?5 OR media.size IS NOT ?6"#,
        )
        .bind(c.root_id)
        .bind(&c.path)
        .bind(c.kind)
        .bind(&c.ext)
        .bind(c.size)
        .bind(c.mtime)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        changed += res.rows_affected();
    }
    Ok(changed)
}

/// A candidate file collected in pass 1 (metadata read once during the walk).
struct Candidate {
    root_id: i64,
    path: String,
    kind: &'static str,
    ext: String,
    size: i64,
    mtime: i64,
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

/// Per-root scan locks so watcher-triggered and manual rescans coalesce.
static SCAN_LOCKS: std::sync::Mutex<Option<HashMap<i64, Arc<AsyncMutex<()>>>>> =
    std::sync::Mutex::new(None);

fn scan_lock(root_id: i64) -> Arc<AsyncMutex<()>> {
    let mut guard = SCAN_LOCKS.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.entry(root_id).or_default().clone()
}

/// Walks `root` recursively, upserts media rows, emits `scan-progress`.
/// Returns (files_seen, media_added_or_updated).
/// Concurrent scans of the same root fail fast with "already scanning".
pub async fn scan_root(
    app: &AppHandle,
    pool: &SqlitePool,
    root_id: i64,
    root_path: &Path,
) -> Result<(u64, u64), String> {
    let lock = scan_lock(root_id);
    if lock.try_lock().is_err() {
        return Err("already scanning".to_string());
    }
    let _guard = lock.lock().await;

    let allowed = whitelist(pool).await;

    // Pass 1: collect candidates WITH metadata (one fs round-trip per file).
    let mut candidates: Vec<Candidate> = Vec::new();
    let walker = WalkDir::new(root_path).follow_links(false).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.depth() == 0 {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // unreadable — skip
        };
        if is_hidden_or_system(&meta) {
            continue; // skip hidden/system files AND dirs (no descent)
        }
        if !is_dir && meta.is_file() {
            let ext = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if !ext.is_empty() && allowed.contains(&ext) {
                candidates.push(Candidate {
                    root_id,
                    path: entry.path().to_string_lossy().to_string(),
                    kind: kind_for_ext(&ext),
                    ext,
                    size: meta.len() as i64,
                    mtime: mtime_secs(&meta),
                });
            }
        }
    }

    let total = candidates.len() as u64;
    let mut done = 0u64;
    let mut added = 0u64;

    emit_progress(app, root_id, "walk", 0, total, String::new(), 0);

    // Pass 1b: batched upserts — 500 rows per transaction.
    let started = std::time::Instant::now();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("db acquire failed: {e}"))?;
    for chunk in candidates.chunks(UPSERT_CHUNK) {
        let mut tx = conn
            .begin()
            .await
            .map_err(|e| format!("tx begin failed: {e}"))?;
        let n = upsert_chunk(&mut tx, chunk).await?;
        tx.commit().await.map_err(|e| format!("tx commit failed: {e}"))?;
        added += n;
        done = (done + chunk.len() as u64).min(total);
        if let Some(last) = chunk.last() {
            emit_progress(app, root_id, "walk", done, total, last.path.clone(), added);
        }
    }
    drop(conn);
    log::info!(
        "scan of {root_id} ({} files) took {:.2}s ({added} changed)",
        total,
        started.elapsed().as_secs_f32()
    );

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

