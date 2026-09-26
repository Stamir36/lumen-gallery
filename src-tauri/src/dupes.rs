//! Duplicate finder (additive, read-only).
//!
//! Three cheap passes, each one narrowing the set before it touches the disk:
//!
//!   1. SQL groups the library by file SIZE — a duplicate always has an equal
//!      size, and most files have no size twin at all, so this usually removes
//!      almost everything without opening a single file;
//!   2. the remaining candidates get a hash of their FIRST 64 KiB — enough to
//!      separate two different photos that happen to weigh the same;
//!   3. only the files that survive both get fully hashed.
//!
//! Nothing is written: the command reports groups, and the UI decides what to
//! do about them. The hashing runs on a blocking thread, so a library on a slow
//! drive cannot stall the app's async runtime.
//!
//! Hash choice: FNV-1a 64. It is not cryptographic — a collision would mean two
//! files share a group, and the cost of that is a wasted look, not data loss.
//! That is a deliberate trade for having no dependency and no key setup.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use serde::Serialize;
use sqlx::Row;
use tauri::{AppHandle, Emitter};

/// Below this, equal sizes are mostly icons, cursors and UI sprites rather than
/// anything a person would call a duplicate.
const DEFAULT_MIN_BYTES: i64 = 64 * 1024;

/// How much of a file goes into the cheap pass.
const HEAD_BYTES: usize = 64 * 1024;

/// Chunk size for the full pass — big enough to keep syscalls down, small
/// enough to keep the buffer off the heap ceiling.
const BODY_CHUNK: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeItem {
    pub id: i64,
    pub path: String,
    pub size: i64,
    pub mtime: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub thumb_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeGroup {
    /// size of ONE copy — every file in the group is this big
    pub size: i64,
    /// what recycling all but the kept copy would give back
    pub wasted_bytes: i64,
    /// oldest first, so "keep the first" is the intuitive default
    pub items: Vec<DupeItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeReport {
    pub groups: Vec<DupeGroup>,
    /// rows that entered the size comparison
    pub candidates: usize,
    /// files the full pass actually read end to end
    pub hashed: usize,
    pub min_bytes: i64,
}

fn fnv1a(bytes: &[u8], seed: u64) -> u64 {
    let mut h = seed;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// Progress event payload: which pass is running and how far through it.
/// `stage` mirrors the three passes: "head" (first 64 KiB) then "full".
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress<'a> {
    stage: &'a str,
    done: usize,
    total: usize,
}

/// The UI paints a bar from these; a per-file event would flood the IPC
/// channel for nothing, so it fires every few files and on the final one.
fn emit_progress(app: &AppHandle, stage: &'static str, done: usize, total: usize) {
    let _ = app.emit("dupes-progress", ScanProgress { stage, done, total });
}

/// Hash of the first `HEAD_BYTES`, or `None` when the file cannot be read
/// (offline drive, permissions, a file that vanished since the last scan).
fn head_hash(path: &str) -> Option<u64> {
    let mut file = File::open(path).ok()?;
    let mut buf = vec![0u8; HEAD_BYTES];
    let mut filled = 0usize;
    while filled < HEAD_BYTES {
        match file.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => return None,
        }
    }
    buf.truncate(filled);
    Some(fnv1a(&buf, FNV_OFFSET))
}

/// Hash of the whole file, continuing from the head hash.
fn full_hash(path: &str) -> Option<u64> {
    let mut file = File::open(path).ok()?;
    let mut hash = FNV_OFFSET;
    let mut buf = vec![0u8; BODY_CHUNK];
    loop {
        match file.read(&mut buf) {
            Ok(0) => return Some(hash),
            Ok(n) => hash = fnv1a(&buf[..n], hash),
            Err(_) => return None,
        }
    }
}

/// Group `items` by a key, keeping only the keys that collide.
fn colliding<K: std::hash::Hash + Eq, T>(items: Vec<T>, mut key: impl FnMut(&T) -> K) -> Vec<Vec<T>> {
    let mut buckets: HashMap<K, Vec<T>> = HashMap::new();
    for item in items {
        buckets.entry(key(&item)).or_default().push(item);
    }
    buckets.into_values().filter(|b| b.len() > 1).collect()
}

fn scan(app: &AppHandle, candidates: Vec<DupeItem>, hashed: &mut usize) -> Vec<DupeGroup> {
    // 2 — one head hash per candidate that still has a size twin
    let head_total = candidates.len();
    let mut head_checked: Vec<(DupeItem, u64)> = Vec::with_capacity(candidates.len());
    for (i, item) in candidates.into_iter().enumerate() {
        if let Some(head) = head_hash(&item.path) {
            head_checked.push((item, head));
        }
        let done = i + 1;
        if done % 32 == 0 || done == head_total {
            emit_progress(app, "head", done, head_total);
        }
    }

    let mut groups: Vec<DupeGroup> = Vec::new();

    // the same head: only now is it worth reading the files through. The total
    // is known up front (buckets are collected first), so the bar is exact.
    let buckets = colliding(head_checked, |(_, head)| *head);
    let full_total: usize = buckets.iter().map(|b| b.len()).sum();
    let mut full_done = 0usize;

    for bucket in buckets {
        let mut verified: Vec<(DupeItem, u64)> = Vec::with_capacity(bucket.len());
        for (item, _) in bucket {
            full_done += 1;
            if let Some(full) = full_hash(&item.path) {
                *hashed += 1;
                verified.push((item, full));
            }
            if full_done % 8 == 0 || full_done == full_total {
                emit_progress(app, "full", full_done, full_total);
            }
        }
        for collided in colliding(verified, |(_, full)| *full) {
            let mut items: Vec<DupeItem> = collided.into_iter().map(|(item, _)| item).collect();
            items.sort_by_key(|i| i.mtime);
            let size = items.first().map(|i| i.size).unwrap_or(0);
            let wasted_bytes = size * (items.len() as i64 - 1);
            groups.push(DupeGroup {
                size,
                wasted_bytes,
                items,
            });
        }
    }

    // the biggest win first
    groups.sort_by_key(|g| std::cmp::Reverse(g.wasted_bytes));
    groups
}

/// Read-only: find media files that share their content.
///
/// `min_bytes` exists because equal-sized 4 KB assets are noise; the UI offers a
/// couple of thresholds, the default keeps them out.
#[tauri::command]
pub async fn find_duplicates(app: AppHandle, min_bytes: Option<i64>) -> Result<DupeReport, String> {
    let min = min_bytes.unwrap_or(DEFAULT_MIN_BYTES).max(0);
    let pool = crate::commands::pool_for(&app).await?;

    let rows = sqlx::query(
        r#"SELECT id, path, size, mtime, width, height, thumb_path
           FROM media
           WHERE trashed = 0 AND excluded = 0 AND offline = 0 AND size >= ?1
           ORDER BY size DESC"#,
    )
    .bind(min)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    // 1 — size is the only free signal, and it is exact
    let all: Vec<DupeItem> = rows
        .iter()
        .map(|row| DupeItem {
            id: row.get("id"),
            path: row.get("path"),
            size: row.get("size"),
            mtime: row.get("mtime"),
            width: row.get("width"),
            height: row.get("height"),
            thumb_path: row.get("thumb_path"),
        })
        .collect();
    let candidates: Vec<DupeItem> = colliding(all, |i| i.size).into_iter().flatten().collect();
    let candidate_count = candidates.len();

    // On a network or removable drive this reads real bytes, so it must not run
    // on an async worker where it would block every other command. `usize` is
    // Copy, so the counter has to travel back out of the closure.
    let (groups, hashed) = tauri::async_runtime::spawn_blocking(move || {
        let mut hashed = 0usize;
        let groups = scan(&app, candidates, &mut hashed);
        (groups, hashed)
    })
    .await
    .map_err(|e| e.to_string())?;

    log::info!(
        "duplicates: {} candidates, {} fully hashed, {} groups",
        candidate_count,
        hashed,
        groups.len()
    );

    Ok(DupeReport {
        groups,
        candidates: candidate_count,
        hashed,
        min_bytes: min,
    })
}
