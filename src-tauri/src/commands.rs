//! Tauri commands: roots, rescan, volumes, media listing.

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::db::DB_URL;
use crate::scan::{self, MediaRow};
use crate::volumes::{self, VolumeInfo};

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
fn capacity_for(path: &str) -> (i64, i64) {
    let vols = volumes::list_volumes();
    let norm = path.replace('/', "\\").to_lowercase();
    let mut best: Option<&VolumeInfo> = None;
    for v in &vols {
        let mp = v.mount_point.to_lowercase();
        if norm.starts_with(&mp) && best.map(|b| mp.len() > b.mount_point.len()).unwrap_or(true) {
            best = Some(v);
        }
    }
    match best.or_else(|| vols.first()) {
        Some(v) => (v.total_bytes as i64, v.available_bytes as i64),
        None => (0, 0),
    }
}

fn root_from_row(r: &sqlx::sqlite::SqliteRow) -> RootRow {
    let path: String = r.get("path");
    let (total, avail) = capacity_for(&path);
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
    scan::spawn_watcher(
        app.clone(),
        pool.clone(),
        root.id,
        std::path::PathBuf::from(&path),
    );

    Ok(root)
}

#[tauri::command]
pub async fn remove_root(app: AppHandle, id: i64) -> Result<(), String> {
    let pool = pool_for(&app).await?;
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

/// Paginated media listing (filter is a stub for Phase 3 search/sort).
#[tauri::command]
pub async fn list_media(
    app: AppHandle,
    limit: Option<i64>,
    offset: Option<i64>,
    filter: Option<String>,
) -> Result<Vec<MediaRow>, String> {
    let pool = pool_for(&app).await?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    let sql = match filter.as_deref() {
        Some("images") => {
            "SELECT * FROM media WHERE trashed = 0 AND kind = 'image' ORDER BY mtime DESC LIMIT ?1 OFFSET ?2"
        }
        Some("videos") => {
            "SELECT * FROM media WHERE trashed = 0 AND kind = 'video' ORDER BY mtime DESC LIMIT ?1 OFFSET ?2"
        }
        Some("favorites") => {
            "SELECT * FROM media WHERE trashed = 0 AND favorite = 1 ORDER BY mtime DESC LIMIT ?1 OFFSET ?2"
        }
        Some("trash") => {
            "SELECT * FROM media WHERE trashed = 1 ORDER BY mtime DESC LIMIT ?1 OFFSET ?2"
        }
        _ => "SELECT * FROM media WHERE trashed = 0 ORDER BY mtime DESC LIMIT ?1 OFFSET ?2",
    };

    let rows = sqlx::query(sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| MediaRow {
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
        })
        .collect())
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

