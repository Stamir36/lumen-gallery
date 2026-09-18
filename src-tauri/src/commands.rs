//! Tauri commands: roots, rescan, volumes, media listing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::db::DB_URL;
use crate::scan::{self, MediaRow};

/// Tauri command: cooperatively abort the running scan of `root_id`.
#[tauri::command]
pub fn cancel_scan(root_id: i64) {
    scan::request_cancel(root_id);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchProgress {
    pub media_id: i64,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
}

/// Resume position for the requested media ids (STEP 2). Read-only, so the pool
/// is fine; the player asks once per opened item, not per frame.
#[tauri::command]
pub async fn watch_progress(
    app: AppHandle,
    ids: Vec<i64>,
) -> Result<Vec<WatchProgress>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let pool = pool_for(&app).await?;
    let placeholders = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT media_id, position_ms, duration_ms FROM watch_progress WHERE media_id IN ({placeholders})"
    );
    let mut query = sqlx::query(&sql);
    for id in &ids {
        query = query.bind(*id);
    }
    let rows = query.fetch_all(&pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| WatchProgress {
            media_id: r.get("media_id"),
            position_ms: r.get("position_ms"),
            duration_ms: r.try_get("duration_ms").unwrap_or(None),
        })
        .collect())
}

/// Stores a watch position through the single writer. Fire-and-forget by design:
/// playback must never wait on (or fail because of) the database.
#[tauri::command]
pub async fn save_progress(
    app: AppHandle,
    id: i64,
    position_ms: i64,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    app.state::<crate::writer::DbWriter>()
        .progress(id, position_ms, duration_ms)
        .await;
    Ok(())
}

/// F5 — custom mini-player: a frameless always-on-top child window replacing
/// the OS-painted browser PiP (its caption cannot be styled away). The payload
/// is injected via `window.eval` + a command hand-off instead of an event so
/// the freshly created webview can never miss the message.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniPayload {
    pub row: crate::scan::MediaRow,
    pub position_ms: i64,
}

/// F5: last known (media_id, position_ms) of the mini player, refreshed by
/// `mini_note_position` (on pause + every 5 s) so that a close via ANY path
/// (X, taskbar, Alt+F4) can emit a recent position even though the mini's
/// webview is already going down and cannot speak for itself.
#[derive(Default)]
pub struct MiniPlayerState(pub std::sync::Mutex<Option<(i64, i64)>>);

#[tauri::command]
pub async fn mini_note_position(
    app: AppHandle,
    media_id: i64,
    position_ms: i64,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<MiniPlayerState>() {
        *state.0.lock().unwrap() = Some((media_id, position_ms));
    }
    Ok(())
}

#[tauri::command]
pub async fn open_mini_player(app: AppHandle, payload: MiniPayload) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    if let Some(existing) = app.get_webview_window("mini") {
        // already open: hand over the new media and focus it
        existing
            .eval(format!("window.__LUMEN_MINI__ = {payload_json};"))
            .map_err(|e| e.to_string())?;
        let _ = existing.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        &app,
        "mini",
        WebviewUrl::App("index.html#/miniplayer".into()),
    )
    .title("LUMEN mini")
    .inner_size(460.0, 260.0)
    .min_inner_size(320.0, 180.0)
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    // injected once navigation has started; the route polls briefly on mount
    window
        .eval(format!("window.__LUMEN_MINI__ = {payload_json};"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The mini player hands its position back; the main window resumes there and
/// the mini closes (F5). Called for the return button, the X button and the
/// window-close request alike.
#[tauri::command]
pub async fn mini_return(
    app: AppHandle,
    media_id: i64,
    position_ms: i64,
    close: bool,
) -> Result<(), String> {
    use tauri::Emitter;
    app.emit(
        "mini-return",
        serde_json::json!({ "mediaId": media_id, "positionMs": position_ms }),
    )
    .map_err(|e| e.to_string())?;
    if close {
        if let Some(mini) = app.get_webview_window("mini") {
            mini.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Saves a webview-captured frame to `<Pictures>/Lumen` and returns the path
/// (STEP 2 frame snapshot). The name is sanitised here, not in the frontend.
#[tauri::command]
pub async fn save_snapshot(
    app: AppHandle,
    bytes: Vec<u8>,
    name: String,
) -> Result<String, String> {
    let dir = app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join("Lumen");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(80)
        .collect();
    let stem = safe.trim().trim_end_matches(".jpg").trim();
    let stem = if stem.is_empty() { "snapshot" } else { stem };
    let path = dir.join(format!("{stem}.jpg"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Does the configured external player exist? (Settings › System › Check.)
#[tauri::command]
pub async fn check_player(path: String) -> bool {
    let p = path.trim();
    !p.is_empty() && std::path::Path::new(p).is_file()
}

/// Reveal a path in Explorer: a directory opens as-is, a file gets /select,
/// a not-yet-existing path (fresh logs/thumbs dir) is created first.
#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(path.trim());
    let select = p.is_file();
    if !select && !p.is_dir() {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flash for a background helper
        let mut cmd = std::process::Command::new("explorer");
        cmd.creation_flags(0x0800_0000);
        if select {
            cmd.arg("/select,").arg(&p);
        } else {
            cmd.arg(&p);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Real trash deletion (P6): hand every file to the OS recycle bin via the
/// `trash` crate, then drop its DB row through the single writer. Per-item
/// failures are collected — rows without a successful file delete are KEPT,
/// so the library never loses track of a file that still exists.
#[tauri::command]
pub async fn trash_delete(paths: Vec<String>) -> Result<usize, String> {
    let mut deleted = 0usize;
    let mut failed: Vec<String> = Vec::new();
    for p in &paths {
        match trash::delete(std::path::Path::new(p)) {
            Ok(()) => deleted += 1,
            Err(e) => failed.push(format!("{p}: {e}")),
        }
    }
    if !failed.is_empty() {
        log::warn!("trash_delete: {} file(s) failed", failed.len());
        for f in failed.iter().take(5) {
            log::warn!("trash_delete: {f}");
        }
        return Err(format!(
            "{} of {} file(s) could not be moved to the recycle bin",
            failed.len(),
            paths.len()
        ));
    }
    Ok(deleted)
}

/// Open an http(s) URL in the user's default browser (About card link).
/// Whitelist-shaped: only absolute http/https URLs are ever passed to the OS.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("only http(s) URLs can be opened".into());
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd")
      .args(["/C", "start", "", &url])
      .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
      .spawn()
      .map_err(|e| e.to_string())?;
    Ok(())
  }
  #[cfg(not(windows))]
  {
    std::process::Command::new("xdg-open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

#[tauri::command]
pub async fn open_external(app: AppHandle, path: String) -> Result<(), String> {
    let pool = pool_for(&app).await?;
    let configured: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'external_player'")
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let player = configured.unwrap_or_default();
    let player = player.trim();

    #[cfg(windows)]
    {
        // `start` takes a window title first: pass an empty one so a quoted
        // player path (with spaces) is not mistaken for the title.
        let mut cmd = std::process::Command::new("cmd");
        if player.is_empty() {
            cmd.args(["/C", "start", "", &path]);
        } else {
            cmd.args(["/C", "start", "", player, &path]);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = player;
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Set once the writer task and the asset scope are live (S1.10). The frontend
/// awaits this before its first library query, which is what removes the
/// first-open flicker (queries used to race migrations + scope extension).
#[derive(Default)]
pub struct BackendState {
    pub ready: AtomicBool,
}

/// Probe for the `backend-ready` event: it may have fired before the window
/// attached its listener, so the frontend checks this instead of waiting blind.
#[tauri::command]
pub fn backend_ready(state: State<'_, BackendState>) -> bool {
    state.ready.load(Ordering::SeqCst)
}

/// Records a thumbnail produced in the webview (video frame capture, or the
/// browser-decoder fallback) through the SINGLE WRITER. These writes used to go
/// straight to the sql plugin / pool, which is exactly where the 1.3-1.7s
/// single-row slow statements in the user's log came from.
#[tauri::command]
pub async fn thumb_record(
    app: AppHandle,
    id: i64,
    thumb_path: String,
    dominant_color: String,
    duration_ms: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
) -> Result<(), String> {
    app.state::<crate::writer::DbWriter>()
        .thumb_ok(crate::writer::ThumbOkItem {
            media_id: id,
            thumb_path,
            dominant_color,
            duration_ms,
            width: width.unwrap_or(0),
            height: height.unwrap_or(0),
        })
        .await;
    Ok(())
}

/// UI-critical single-statement writes go through the single-writer task with a
/// oneshot completion — same ordering as the batched thumb updates, no lock
/// contention. `sql` must be a fixed-shape statement; `params` bind positionally.
#[tauri::command]
pub async fn db_exec(
    app: AppHandle,
    sql: String,
    params: Vec<String>,
) -> Result<u64, String> {
    // ONLY fixed-shape UI statements are whitelisted: the writer is not a
    // general-purpose SQL passthrough.
    const ALLOWED: &[&str] = &[
        "UPDATE media SET favorite",
        "UPDATE media SET trashed",
        "INSERT INTO settings",
        "UPDATE settings",
        "DELETE FROM media WHERE id",
    ];
    if !ALLOWED.iter().any(|a| sql.starts_with(a)) {
        return Err("statement not allowed through db_exec".into());
    }
    if sql.len() > 4_096 || params.len() > 512 {
        return Err("statement out of bounds".into());
    }

    use tauri::Manager;
    // Owned statement text: the previous `Box::leak` leaked one string per UI
    // write (every heart click) for the whole session.
    app.state::<crate::writer::DbWriter>()
        .inner()
        .exec(sql, params)
        .await
}
use crate::volumes::{self, VolumeInfo};
use crate::watch::{spawn_watcher, WatcherRegistry};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRow {
    pub id: i64,
    pub path: String,
    pub kind: String,
    pub label: String,
    pub added_at: i64,
    pub item_count: i64,
    pub total_bytes: i64,
    pub available_bytes: i64,
}

/// Resolves the application's SQLite pool.
pub async fn pool_for(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let dbmap = instances.0.read().await;
    match dbmap.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => Ok(p.clone()),
        _ => Err("database not initialized".to_string()),
    }
}

/// Best-effort capacity numbers for a root path (uses its owning drive).
/// Returns None when no volume matches — callers show a mono dash instead of
/// inventing another drive's numbers.
fn capacity_for(path: &str) -> Option<(i64, i64)> {
    let vols = volumes::list_volumes();
    let norm = path.replace('/', "\\").to_lowercase();
    let mut best: Option<&VolumeInfo> = None;
    for v in &vols {
        let mp = v.mount_point.to_lowercase();
        if norm.starts_with(&mp) && best.map(|b| mp.len() > b.mount_point.len()).unwrap_or(true) {
            best = Some(v);
        }
    }
    best.map(|v| (v.total_bytes as i64, v.available_bytes as i64))
}

fn root_from_row(r: &sqlx::sqlite::SqliteRow) -> RootRow {
    let path: String = r.get("path");
    let (total, avail) = capacity_for(&path).unwrap_or((0, 0));
    RootRow {
        id: r.get("id"),
        path,
        kind: r.get("kind"),
        label: r.get("label"),
        added_at: r.get("added_at"),
        item_count: r.try_get("item_count").unwrap_or(0),
        total_bytes: total,
        available_bytes: avail,
    }
}

/// Lists available drives (real volumes only).
#[tauri::command]
pub fn get_volumes() -> Vec<VolumeInfo> {
    volumes::list_volumes()
}

/// Adds a root, kicks off an initial scan and starts its watcher.
#[tauri::command]
pub async fn add_root(
    app: AppHandle,
    path: String,
    kind: Option<String>,
    label: Option<String>,
) -> Result<RootRow, String> {
    let pool = pool_for(&app).await?;
    let p = std::path::Path::new(&path);
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }

    let kind = kind.unwrap_or_else(|| {
        volumes::list_volumes()
            .into_iter()
            .find(|v| path.to_lowercase().starts_with(&v.mount_point.to_lowercase()))
            .map(|v| v.kind)
            .unwrap_or_else(|| "folder".to_string())
    });
    let label = label.unwrap_or_else(|| {
        p.file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.clone())
    });

    sqlx::query("INSERT OR IGNORE INTO roots (path, kind, label) VALUES (?1, ?2, ?3)")
        .bind(&path)
        .bind(&kind)
        .bind(&label)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT r.*, (SELECT COUNT(*) FROM media m WHERE m.root_id = r.id) AS item_count
         FROM roots r WHERE r.path = ?1",
    )
    .bind(&path)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let root = root_from_row(&row);

    let app2 = app.clone();
    let pool2 = pool.clone();
    let root_id = root.id;
    let path_buf = std::path::PathBuf::from(&path);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = scan::scan_root(&app2, &pool2, root_id, &path_buf).await {
            log::warn!("initial scan failed for {path_buf:?}: {e}");
        }
    });
    let registry = app.state::<WatcherRegistry>();
    spawn_watcher(
        app.clone(),
        pool.clone(),
        &registry,
        root.id,
        std::path::PathBuf::from(&path),
    );

    // asset protocol: allow convertFileSrc() to serve files from this root
    crate::assets::allow_dir(&app, std::path::Path::new(&path));

    Ok(root)
}

#[tauri::command]
pub async fn remove_root(
    app: AppHandle,
    registry: State<'_, WatcherRegistry>,
    id: i64,
) -> Result<(), String> {
    let pool = pool_for(&app).await?;
    // Stop the watcher FIRST so it cannot rescan a deleted root_id.
    registry.remove(id);
    sqlx::query("DELETE FROM roots WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_roots(app: AppHandle) -> Result<Vec<RootRow>, String> {
    let pool = pool_for(&app).await?;
    let rows = sqlx::query(
        "SELECT r.*, (SELECT COUNT(*) FROM media m WHERE m.root_id = r.id) AS item_count
         FROM roots r ORDER BY r.added_at ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(root_from_row).collect())
}

#[tauri::command]
pub async fn rescan_root(app: AppHandle, id: i64) -> Result<u64, String> {
    let pool = pool_for(&app).await?;
    let path: String = sqlx::query_scalar("SELECT path FROM roots WHERE id = ?1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let (seen, _) = scan::scan_root(&app, &pool, id, std::path::Path::new(&path)).await?;
    Ok(seen)
}

#[tauri::command]
pub async fn rescan_all(app: AppHandle) -> Result<u64, String> {
    let pool = pool_for(&app).await?;
    let roots: Vec<(i64, String)> = sqlx::query_as("SELECT id, path FROM roots")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut seen = 0u64;
    for (id, path) in roots {
        match scan::scan_root(&app, &pool, id, std::path::Path::new(&path)).await {
            Ok((s, _)) => seen += s,
            Err(e) => log::warn!("rescan failed for {path}: {e}"),
        }
    }
    Ok(seen)
}

/// Lowercased final path segment — the sort key for "sort by name".
fn base_name(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_lowercase()
}

/// Separator used by a stored path (Windows roots use `\\`).
fn separator_of(path: &str) -> char {
    if path.contains('\\') {
        '\\'
    } else {
        '/'
    }
}

/// True when `path` sits DIRECTLY in `dir` (no further folder in between).
fn direct_child(path: &str, dir: &str) -> bool {
    let sep = separator_of(dir);
    let prefix = if dir.ends_with(sep) {
        dir.to_string()
    } else {
        format!("{dir}{sep}")
    };
    match path.strip_prefix(&prefix) {
        Some(rest) => !rest.is_empty() && !rest.contains(['\\', '/']),
        None => false,
    }
}

/// The first folder segment of `path` below `dir`, if the file is nested.
fn nested_folder(path: &str, dir: &str) -> Option<String> {
    let sep = separator_of(dir);
    let prefix = if dir.ends_with(sep) {
        dir.to_string()
    } else {
        format!("{dir}{sep}")
    };
    let rest = path.strip_prefix(&prefix)?;
    let i = rest.find(['\\', '/'])?;
    let (segment, tail) = (&rest[..i], &rest[i + 1..]);
    if segment.is_empty() || tail.is_empty() {
        return None;
    }
    Some(format!("{prefix}{segment}"))
}

fn media_from_row(r: &sqlx::sqlite::SqliteRow) -> MediaRow {
    MediaRow {
        id: r.get("id"),
        root_id: r.get("root_id"),
        path: r.get("path"),
        kind: r.get("kind"),
        ext: r.get("ext"),
        size: r.get("size"),
        mtime: r.get("mtime"),
        width: r.try_get("width").unwrap_or(None),
        height: r.try_get("height").unwrap_or(None),
        duration_ms: r.try_get("duration_ms").unwrap_or(None),
        favorite: r.get::<i64, _>("favorite") == 1,
        trashed: r.get::<i64, _>("trashed") == 1,
        added_at: r.get("added_at"),
        thumb_path: r.try_get("thumb_path").unwrap_or(None),
        dominant_color: r.try_get("dominant_color").unwrap_or(None),
        thumb_error: r.try_get::<i64, _>("thumb_error").unwrap_or(0) == 1,
        offline: r.try_get::<i64, _>("offline").unwrap_or(0) == 1,
        excluded: r.try_get::<i64, _>("excluded").unwrap_or(0) == 1,
    }
}

/// LIKE pattern escaping (paths may contain % or _ — a wildcard there would
/// silently widen the folder queue).
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Raw CLI args for the external-open pipeline (STEP 3). Tauri core has no
/// cross-plugin args accessor, so the plugin-free probe reads them directly.
#[tauri::command]
pub fn cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// STEP 3 result: the requested row plus the queue (its folder) to open it in.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileResult {
    pub row: MediaRow,
    pub queue: Vec<MediaRow>,
    pub index: usize,
}

/// A file opened through the OS (association, drag onto the exe, single-instance
/// forward) goes straight into the viewer with its folder as the queue.
#[tauri::command]
pub async fn open_file(app: AppHandle, path: String) -> Result<OpenFileResult, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("file does not exist: {path}"));
    }
    // the asset protocol (and the fs-decoder fallback) must serve this file even
    // though the folder was never added as a library root
    if let Some(parent) = p.parent() {
        crate::assets::allow_dir(&app, parent);
    }

    let pool = pool_for(&app).await?;
    let norm = path.replace('/', "\\");
    let known = sqlx::query(
        "SELECT * FROM media WHERE trashed = 0 AND REPLACE(path, '/', '\\') = ?1",
    )
    .bind(&norm)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let row = match known {
        Some(r) => media_from_row(&r),
        None => {
            // not indexed (yet): derive a minimal row from the filesystem so the
            // viewer still opens it; the queue below falls back to just this file
            let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let kind = if crate::db::IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                "image"
            } else {
                "video"
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            MediaRow {
                id: -1,
                root_id: -1,
                path: path.clone(),
                kind: kind.into(),
                ext,
                size: meta.len() as i64,
                mtime,
                width: None,
                height: None,
                duration_ms: None,
                favorite: false,
                trashed: false,
                added_at: 0,
                thumb_path: None,
                dominant_color: None,
                thumb_error: false,
                offline: false,
                excluded: false,
            }
        }
    };

    // queue = folder contents in the library's default order (date desc, path
    // asc — the same tie-break list_media uses), so arrows/filmstrip walk the
    // folder exactly like the grid would
    let dir = row
        .path
        .rsplit_once('\\')
        .map(|(d, _)| d.to_string())
        .or_else(|| row.path.rsplit_once('/').map(|(d, _)| d.to_string()));
    let mut queue: Vec<MediaRow> = Vec::new();
    if let Some(dir) = dir {
        let pattern = format!("{}\\%", like_escape(&dir));
        let rows = sqlx::query(
            "SELECT * FROM media WHERE trashed = 0 AND excluded = 0 \n             AND path LIKE ?1 ESCAPE '\\' ORDER BY mtime DESC, path ASC",
        )
        .bind(pattern)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        queue = rows.iter().map(media_from_row).collect();
    }
    if queue.is_empty() {
        queue.push(row.clone());
    }
    let index = queue
        .iter()
        .position(|m| m.path == row.path)
        .unwrap_or(0);
    Ok(OpenFileResult { row, queue, index })
}

/// Library listing for the grid.
///
/// v1 strategy: pull the rows for the cheap SQL predicates (trash/kind/
/// favorite/root), then filter `dir` + substring `q` and sort in Rust so one
/// code path owns path semantics and ordering. Justified rows are width-
/// dependent and grouping is date-based, so the grid needs the whole ordered
/// set anyway (9.4k rows ≈ single-digit MB). If a library ever passes ~200k
/// rows this becomes a keyset-paginated load — see TODO.md.
// Tauri commands mirror the frontend query object field for field.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn list_media(
    app: AppHandle,
    limit: Option<i64>,
    offset: Option<i64>,
    filter: Option<String>,
    root_id: Option<i64>,
    dir: Option<String>,
    q: Option<String>,
    sort: Option<String>,
    desc: Option<bool>,
    include_excluded: Option<bool>,
) -> Result<Vec<MediaRow>, String> {
    let pool = pool_for(&app).await?;
    let limit = limit.unwrap_or(500).clamp(1, 200_000);
    let offset = offset.unwrap_or(0).max(0);

    let mut sql = String::from("SELECT * FROM media WHERE trashed = 0");
    match filter.as_deref() {
        Some("trash") => {
            sql = String::from("SELECT * FROM media WHERE trashed = 1");
        }
        Some("images") => sql.push_str(" AND kind = 'image'"),
        Some("videos") => sql.push_str(" AND kind = 'video'"),
        Some("favorites") => sql.push_str(" AND favorite = 1"),
        _ => {}
    }
    // excluded folders are invisible unless the user explicitly asks to see
    // them (Settings › Appearance → "show excluded", FIX 5)
    if !include_excluded.unwrap_or(false) {
        sql.push_str(" AND excluded = 0");
    }
    if root_id.is_some() {
        sql.push_str(" AND root_id = ?");
    }

    let mut query = sqlx::query(&sql);
    if let Some(id) = root_id {
        query = query.bind(id);
    }
    let rows = query.fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let needle = q.unwrap_or_default().trim().to_lowercase();
    let mut items: Vec<MediaRow> = rows
        .iter()
        .map(media_from_row)
        .filter(|m| dir.as_deref().map(|d| direct_child(&m.path, d)).unwrap_or(true))
        .filter(|m| needle.is_empty() || m.path.to_lowercase().contains(&needle))
        .collect();

    let key = sort.as_deref().unwrap_or("date");
    let descending = desc.unwrap_or(key != "name");
    items.sort_by(|a, b| {
        let mut ord = match key {
            "name" => base_name(&a.path).cmp(&base_name(&b.path)),
            "size" => a.size.cmp(&b.size),
            "duration" => a.duration_ms.unwrap_or(0).cmp(&b.duration_ms.unwrap_or(0)),
            "added" => a.added_at.cmp(&b.added_at),
            _ => a.mtime.cmp(&b.mtime),
        };
        if descending {
            ord = ord.reverse();
        }
        ord.then_with(|| a.path.cmp(&b.path))
    });

    Ok(items
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect())
}

/// One folder card in the root/folder navigation (STEP 3B).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub path: String,
    pub name: String,
    pub count: i64,
    /// cover = first file with a cached thumb, else the first with a dominant
    /// color, else the newest file in the folder (renders as a color tile).
    pub cover_id: Option<i64>,
    pub cover_thumb: Option<String>,
    pub cover_color: Option<String>,
}

/// Direct subfolders of `dir` (or of the root itself when `dir` is None),
/// each with a recursive media count and a cover candidate.
#[tauri::command]
pub async fn list_folders(
    app: AppHandle,
    root_id: i64,
    dir: Option<String>,
) -> Result<Vec<FolderRow>, String> {
    let pool = pool_for(&app).await?;
    let base = match dir {
        Some(d) => d,
        None => sqlx::query_scalar::<_, String>("SELECT path FROM roots WHERE id = ?1")
            .bind(root_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "root not found".to_string())?,
    };

    let rows = sqlx::query(
        // thumb_error IS NULL filters undecodable files out of the cover pick:
        // a corrupt first file must not make the whole folder card coverless
        "SELECT id, path, thumb_path, dominant_color, thumb_error FROM media WHERE root_id = ?1 AND trashed = 0 AND excluded = 0 ORDER BY mtime DESC",
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    struct Acc {
        name: String,
        count: i64,
        cover_id: i64,
        cover_thumb: Option<String>,
        cover_color: Option<String>,
        /// first child with a (pending) thumb: the webview-side cover fallback
        /// enqueues it when the card shows before the thumb exists
        fallback_id: i64,
        fallback_thumb: Option<String>,
        fallback_color: Option<String>,
    }
    let mut map: HashMap<String, Acc> = HashMap::new();

    for r in &rows {
        let path: String = r.get("path");
        let Some(folder) = nested_folder(&path, &base) else {
            continue;
        };
        let sep = separator_of(&base);
        let name = folder
            .rsplit(sep)
            .next()
            .unwrap_or(folder.as_str())
            .to_string();
        let thumb: Option<String> = r.try_get("thumb_path").unwrap_or(None);
        let color: Option<String> = r.try_get("dominant_color").unwrap_or(None);
        let broken: bool = r.try_get::<i64, _>("thumb_error").unwrap_or(0) == 1;
        let id: i64 = r.get("id");
        let acc = map.entry(folder.clone()).or_insert(Acc {
            name,
            count: 0,
            cover_id: id,
            cover_thumb: None,
            cover_color: None,
            fallback_id: id,
            fallback_thumb: None,
            fallback_color: None,
        });
        acc.count += 1;
        if broken {
            continue; // never a cover from a file known to be undecodable
        }
        // primary chain: cached thumb -> dominant color
        if acc.cover_thumb.is_none() && thumb.is_some() {
            acc.cover_thumb = thumb.clone();
            acc.cover_id = id;
            acc.cover_color = color.clone();
        } else if acc.cover_color.is_none() && color.is_some() {
            acc.cover_color = color.clone();
        }
        // fallback candidate: the newest not-yet-decoded child (any kind)
        if acc.fallback_thumb.is_none() && acc.fallback_color.is_none() {
            acc.fallback_id = id;
            acc.fallback_thumb = thumb;
            acc.fallback_color = color;
        }
    }

    let mut folders: Vec<FolderRow> = map
        .into_iter()
        .map(|(path, a)| {
            // cover chain (FIX 2): ok thumb -> dominant color -> decodable-child
            // fallback -> neutral surface. Rows with thumb_error are skipped as
            // candidates; the fallback keeps a decodable child so the webview
            // can still enqueue a thumb while the card is on screen.
            let has_primary = a.cover_thumb.is_some() || a.cover_color.is_some();
            let (cover_id, cover_thumb, cover_color) = if has_primary {
                (Some(a.cover_id), a.cover_thumb, a.cover_color)
            } else {
                (Some(a.fallback_id), a.fallback_thumb, a.fallback_color)
            };
            FolderRow {
                path,
                name: a.name,
                count: a.count,
                cover_id,
                cover_thumb,
                cover_color,
            }
        })
        .collect();
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok(folders)
}

/// Library counters for the status line.
#[tauri::command]
pub async fn library_stats(app: AppHandle) -> Result<(i64, i64), String> {
    let pool = pool_for(&app).await?;
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE trashed = 0 AND excluded = 0")
            .fetch_one(&pool)
            .await
            .map_err(|e| e.to_string())?;
    let bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(size), 0) FROM media WHERE trashed = 0 AND excluded = 0",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok((total, bytes))
}

/// One row of the "excluded folders" list (Settings › Libraries).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedFolderRow {
    pub id: i64,
    pub root_id: i64,
    pub root_path: String,
    pub path: String,
    pub name: String,
    /// how many media rows this exclusion is currently hiding
    pub hidden: i64,
}

/// Folders the user hid, with the number of files hidden by each.
#[tauri::command]
pub async fn list_excluded(app: AppHandle) -> Result<Vec<ExcludedFolderRow>, String> {
    let pool = pool_for(&app).await?;
    let rows = sqlx::query(
        "SELECT e.id, e.root_id, e.path, r.path AS root_path,
                (SELECT COUNT(*) FROM media m
                  WHERE m.root_id = e.root_id AND m.excluded = 1
                    AND (m.path = e.path
                         OR substr(m.path, 1, length(e.path) + 1)
                            IN (e.path || '\\', e.path || '/'))) AS hidden
           FROM excluded_folders e
           JOIN roots r ON r.id = e.root_id
          ORDER BY r.path, e.path",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let path: String = r.get("path");
            ExcludedFolderRow {
                id: r.get("id"),
                root_id: r.get("root_id"),
                root_path: r.get("root_path"),
                name: path
                    .rsplit(['\\', '/'])
                    .next()
                    .unwrap_or(path.as_str())
                    .to_string(),
                hidden: r.get("hidden"),
                path,
            }
        })
        .collect())
}

/// Hides a folder and everything under it from the library and from the next
/// scan. Written through the single writer, like every other write (S1.12).
#[tauri::command]
pub async fn exclude_folder(app: AppHandle, root_id: i64, path: String) -> Result<(), String> {
    app.state::<crate::writer::DbWriter>()
        .folder_exclusion(root_id, trim_dir(&path), true)
        .await;
    Ok(())
}

/// The restore path: the folder is scanned and shown again.
#[tauri::command]
pub async fn restore_folder(app: AppHandle, root_id: i64, path: String) -> Result<(), String> {
    app.state::<crate::writer::DbWriter>()
        .folder_exclusion(root_id, trim_dir(&path), false)
        .await;
    Ok(())
}

/// Loopback URL for the CORS media server (VR dome, FIX 1).
///
/// The asset protocol taints the canvas (no CORS headers) which is why the VR
/// dome stayed black; this returns an `http://127.0.0.1:<port>/stream?path=…`
/// URL whose response is CORS-clean. Errors when the server is unavailable or
/// the file is outside the library — the caller then falls back to a blob URL
/// or shows the "VR unavailable" card.
#[tauri::command]
pub async fn media_url(app: AppHandle, path: String) -> Result<String, String> {
    let server = crate::media_server::server(&app).ok_or("media server unavailable")?;
    server.refresh(&app).await;
    let p = std::path::PathBuf::from(&path);
    if !server.is_allowed(&p) {
        return Err("file is outside the library roots".into());
    }
    Ok(server.url_for(&path))
}

/// Trailing separators would make the prefix predicate match nothing.
fn trim_dir(path: &str) -> String {
    path.trim_end_matches(['\\', '/']).to_string()
}

/// Sidebar/status counters in one round trip (replaces per-counter queries).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub total: i64,
    pub bytes: i64,
    pub images: i64,
    pub videos: i64,
    pub favorites: i64,
    pub offline: i64,
}

#[tauri::command]
pub async fn library_summary(app: AppHandle) -> Result<LibrarySummary, String> {
    let pool = pool_for(&app).await?;
    let row = sqlx::query(
        r#"SELECT COUNT(*) AS total,
                  COALESCE(SUM(size), 0) AS bytes,
                  COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS images,
                  COALESCE(SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END), 0) AS videos,
                  COALESCE(SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END), 0) AS favorites,
                  COALESCE(SUM(CASE WHEN offline = 1 THEN 1 ELSE 0 END), 0) AS offline
           FROM media WHERE trashed = 0 AND excluded = 0"#,
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(LibrarySummary {
        total: row.get("total"),
        bytes: row.get("bytes"),
        images: row.get("images"),
        videos: row.get("videos"),
        favorites: row.get("favorites"),
        offline: row.get("offline"),
    })
}

