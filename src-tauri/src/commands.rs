//! Tauri commands: roots, rescan, volumes, media listing.

use std::collections::HashMap;

use serde::Serialize;
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
    }
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

    let rows = sqlx::query("SELECT id, path, thumb_path, dominant_color FROM media WHERE root_id = ?1 AND trashed = 0 ORDER BY mtime DESC")
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
        let id: i64 = r.get("id");
        let acc = map.entry(folder.clone()).or_insert(Acc {
            name,
            count: 0,
            cover_id: id,
            cover_thumb: None,
            cover_color: None,
        });
        acc.count += 1;
        if acc.cover_thumb.is_none() && thumb.is_some() {
            acc.cover_thumb = thumb;
            acc.cover_id = id;
            acc.cover_color = color.clone();
        } else if acc.cover_color.is_none() && color.is_some() {
            acc.cover_color = color;
        }
    }

    let mut folders: Vec<FolderRow> = map
        .into_iter()
        .map(|(path, a)| FolderRow {
            path,
            name: a.name,
            count: a.count,
            cover_id: Some(a.cover_id),
            cover_thumb: a.cover_thumb,
            cover_color: a.cover_color,
        })
        .collect();
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok(folders)
}

/// Library counters for the status line.
#[tauri::command]
pub async fn library_stats(app: AppHandle) -> Result<(i64, i64), String> {
    let pool = pool_for(&app).await?;
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE trashed = 0")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let bytes: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(size), 0) FROM media WHERE trashed = 0")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok((total, bytes))
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
           FROM media WHERE trashed = 0"#,
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

