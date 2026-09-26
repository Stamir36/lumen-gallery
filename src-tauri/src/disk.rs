//! Disk space tool (additive, read-only).
//!
//! One SQL pass over the indexed library per section — the same pattern the
//! duplicates finder uses, and the same cost class (no file is ever opened):
//!
//!   1. `top_files` — the heaviest files, size DESC, so the UI can draw the
//!      "where did my disk go" list without any extra scan;
//!   2. `by_extension` — GROUP BY ext, SUM(size): mp4 vs jpg vs png is the
//!      first thing a person wants to see;
//!   3. `by_root` — per-library totals, so a big drive can be blamed by name.

use serde::Serialize;
use sqlx::Row;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskItem {
    pub id: i64,
    pub path: String,
    pub kind: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub thumb_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtUsage {
    pub ext: String,
    pub kind: String,
    pub total_bytes: i64,
    pub file_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootUsage {
    pub root_id: i64,
    pub path: String,
    pub label: String,
    pub total_bytes: i64,
    pub file_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskReport {
    pub top_files: Vec<DiskItem>,
    pub by_extension: Vec<ExtUsage>,
    pub by_root: Vec<RootUsage>,
    /// whole indexed library, bytes — the denominator of every bar
    pub total_bytes: i64,
    pub file_count: i64,
}

/// Read-only: how the indexed library spends its disk space.
///
/// `top_n` clamps the heaviest-files list (the UI asks for 30); grouping is
/// always complete, the totals are exact.
#[tauri::command]
pub async fn disk_usage(app: AppHandle, top_n: Option<i64>) -> Result<DiskReport, String> {
    let top = top_n.unwrap_or(30).clamp(1, 200);
    let pool = crate::commands::pool_for(&app).await?;

    // 1 — the heaviest files
    let rows = sqlx::query(
        r#"SELECT id, path, kind, ext, size, mtime, width, height, thumb_path
           FROM media
           WHERE trashed = 0 AND excluded = 0 AND offline = 0
           ORDER BY size DESC
           LIMIT ?1"#,
    )
    .bind(top)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let top_files = rows
        .iter()
        .map(|r| DiskItem {
            id: r.get("id"),
            path: r.get("path"),
            kind: r.get("kind"),
            ext: r.get("ext"),
            size: r.get("size"),
            mtime: r.get("mtime"),
            width: r.get("width"),
            height: r.get("height"),
            thumb_path: r.get("thumb_path"),
        })
        .collect();

    // 2 — extension buckets, biggest first
    let rows = sqlx::query(
        r#"SELECT ext, MAX(kind) AS kind, SUM(size) AS total, COUNT(*) AS cnt
           FROM media
           WHERE trashed = 0 AND excluded = 0 AND offline = 0
           GROUP BY ext
           ORDER BY SUM(size) DESC"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let by_extension: Vec<ExtUsage> = rows
        .iter()
        .map(|r| ExtUsage {
            ext: r.get("ext"),
            kind: r.get("kind"),
            total_bytes: r.get("total"),
            file_count: r.get("cnt"),
        })
        .collect();

    // 3 — per-root totals (a LEFT JOIN keeps roots that are currently empty)
    let rows = sqlx::query(
        r#"SELECT ro.id AS root_id, ro.path AS path, ro.label AS label,
                  COALESCE(SUM(m.size), 0) AS total, COUNT(m.id) AS cnt
           FROM roots ro
           LEFT JOIN media m
             ON m.root_id = ro.id AND m.trashed = 0 AND m.excluded = 0 AND m.offline = 0
           GROUP BY ro.id, ro.path, ro.label
           ORDER BY COALESCE(SUM(m.size), 0) DESC"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let by_root = rows
        .iter()
        .map(|r| RootUsage {
            root_id: r.get("root_id"),
            path: r.get("path"),
            label: r.get("label"),
            total_bytes: r.get("total"),
            file_count: r.get("cnt"),
        })
        .collect();

    // totals: one extra scalar pass is cheaper than folding three queries
    let totals = sqlx::query(
        r#"SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS cnt
           FROM media
           WHERE trashed = 0 AND excluded = 0 AND offline = 0"#,
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_bytes: i64 = totals.get("total");
    let file_count: i64 = totals.get("cnt");

    log::info!(
        "disk usage: {file_count} files, {total_bytes} bytes, {} extensions",
        by_extension.len()
    );

    Ok(DiskReport {
        top_files,
        by_extension,
        by_root,
        total_bytes,
        file_count,
    })
}
