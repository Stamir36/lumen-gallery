//! One-time data migration for the identity change (Phase 6, STEP 1).
//!
//! Changing the bundle identifier from `app.lumen.gallery` to
//! `com.unesell.lumen` also moves the Tauri data directories (both are
//! per-identifier): the roaming dir holds lumen.db, the local dir holds the
//! thumbnail cache. Without this migration every existing install would boot
//! with an EMPTY library — 9,390 indexed files gone from the UI.
//!
//! Runs once in setup(), before the sql plugin opens the database. Every step
//! is idempotent and non-destructive:
//!  - no old data            -> no-op (fresh install)
//!  - non-empty target file  -> untouched (already migrated)
//!  - db files are COPIED, the old set stays as a manual backup;
//!  - thumbs are MERGED file-by-file, existing targets are never rewritten.

use std::fs;
use std::path::Path;
use tauri::Manager;

const OLD_IDENTIFIER: &str = "app.lumen.gallery";

fn copy_db_files(old_dir: &Path, new_dir: &Path) {
    let names = ["lumen.db", "lumen.db-wal", "lumen.db-shm"];
    for name in names {
        let src = old_dir.join(name);
        let dst = new_dir.join(name);
        let Ok(meta) = fs::metadata(&src) else { continue };
        if !meta.is_file() {
            continue;
        }
        // A target with real bytes means a previous migration (or a new
        // library) already lives here — never overwrite.
        if let Ok(existing) = fs::metadata(&dst) {
            if existing.is_file() && existing.len() > 0 {
                continue;
            }
        }
        if fs::copy(&src, &dst).is_ok() {
            log::info!("legacy data migrated: {} ({} bytes)", name, meta.len());
        } else {
            log::warn!("legacy data migration failed for {name}");
        }
    }
}

fn merge_thumbs(old_dir: &Path, new_dir: &Path) {
    let (old_thumbs, new_thumbs) = (old_dir.join("thumbs"), new_dir.join("thumbs"));
    let Ok(entries) = fs::read_dir(&old_thumbs) else { return };
    if fs::create_dir_all(&new_thumbs).is_err() {
        return;
    }
    let mut moved = 0usize;
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_file() {
            continue;
        }
        let dst = new_thumbs.join(entry.file_name());
        if dst.exists() {
            continue;
        }
        if fs::copy(entry.path(), &dst).is_ok() {
            moved += 1;
        }
    }
    if moved > 0 {
        log::info!("legacy thumbs merged: {moved} files");
    }
}

pub fn migrate(app: &tauri::AppHandle) {
    let Ok(data_root) = app.path().data_dir() else { return };
    let Ok(local_root) = app.path().local_data_dir() else { return };
    let old_data = data_root.join(OLD_IDENTIFIER);
    let old_local = local_root.join(OLD_IDENTIFIER);

    if old_data.is_dir() {
        let new_data = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| data_root.join("com.unesell.lumen"));
        if fs::create_dir_all(&new_data).is_ok() {
            copy_db_files(&old_data, &new_data);
        }
    }
    if old_local.is_dir() {
        let new_cache = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| local_root.join("com.unesell.lumen"));
        if fs::create_dir_all(&new_cache).is_ok() {
            merge_thumbs(&old_local, &new_cache);
        }
    }
}
