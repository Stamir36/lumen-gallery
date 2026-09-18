mod assets;
mod cache;

mod commands;
mod db;
mod media_server;
mod scan;
mod thumbs;
mod volumes;
mod watch;
mod writer;

use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Re-registers the debounced rescan watcher for every stored root (S1.11).
/// Only `add_root` used to do this, so after a restart nothing was watched and
/// new files stayed invisible until a manual rescan.
async fn restore_watchers(handle: &tauri::AppHandle, pool: &sqlx::SqlitePool) {
  let roots: Vec<(i64, String)> = match sqlx::query_as::<_, (i64, String)>(
    "SELECT id, path FROM roots",
  )
  .fetch_all(pool)
  .await
  {
    Ok(rows) => rows,
    Err(e) => {
      log::warn!("could not list roots for watcher restore: {e}");
      return;
    }
  };
  let registry = handle.state::<watch::WatcherRegistry>();
  let mut restored = 0usize;
  for (id, path) in roots {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
      // ejected drive / missing folder: keep the rows, skip the watcher
      log::warn!("root {id} unreachable at boot, watcher skipped: {path}");
      continue;
    }
    // the scope must know about the root before the first thumbnail request
    assets::allow_dir(handle, &p);
    watch::spawn_watcher(handle.clone(), pool.clone(), &registry, id, p);
    restored += 1;
  }
  log::info!("fs watchers restored: {restored}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    Migration {
      version: 1,
      description: "lumen_v1",
      sql: db::MIGRATION_V1,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "lumen_v2_offline_flag",
      sql: db::MIGRATION_V2,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "lumen_v3_thumbnails",
      sql: db::MIGRATION_V3,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "lumen_v4_thumb_error",
      sql: db::MIGRATION_V4,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "lumen_v5_thumb_size",
      sql: db::MIGRATION_V5,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "lumen_v6_watch_progress",
      sql: db::MIGRATION_V6,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "lumen_v7_watch_progress_ms",
      sql: db::MIGRATION_V7,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "lumen_v8_folder_exclusions",
      sql: db::MIGRATION_V8,
      kind: MigrationKind::Up,
    },
  ];

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(db::DB_URL, migrations)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      commands::get_volumes,
      commands::add_root,
      commands::remove_root,
      commands::list_roots,
      commands::rescan_root,
      commands::rescan_all,
      commands::list_media,
      commands::list_folders,
      commands::library_stats,
      commands::library_summary,
      commands::cancel_scan,
      commands::db_exec,
      commands::thumb_record,
      commands::backend_ready,
      commands::watch_progress,
      commands::save_progress,
      commands::list_excluded,
      commands::exclude_folder,
      commands::restore_folder,
      commands::save_snapshot,
      commands::open_external,
      commands::check_player,
      commands::reveal_path,
      commands::media_url,
      cache::thumbnail_cache_size,
      cache::clear_thumbnail_cache,
      thumbs::generate_thumbs,
    ])
    .manage(watch::WatcherRegistry::default())
    .manage(thumbs::ThumbEngine::default())
    .manage(commands::BackendState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Local CORS media server (VR dome, FIX 1): loopback only, ephemeral
      // port, independent of the DB — the allow-list is refreshed below, once
      // the pool exists. Without it VR falls back to blob URLs.
      let media = media_server::start();
      if let Some(srv) = media.clone() {
        app.manage(srv);
      }

      // Enforce + verify pragmas once the pool exists. The pool is created
      // lazily by the plugin on first frontend use (Database.load), so retry
      // briefly. Spawned: NEVER blocks or fails a command path.
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        for _ in 0..30 {
          tokio::time::sleep(std::time::Duration::from_millis(500)).await;
          if let Ok(pool) = commands::pool_for(&handle).await {
            let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await;
            let _ = sqlx::query("PRAGMA journal_mode = WAL").execute(&pool).await;
            let _ = sqlx::query("PRAGMA synchronous = NORMAL").execute(&pool).await;
            let _ = sqlx::query(format!("PRAGMA busy_timeout = {}", writer::BUSY_TIMEOUT_MS).as_str())
              .execute(&pool)
              .await;

            // single-writer: EVERY media write (thumbs batched, UI immediate)
            // goes through one task — no more write-lock contention storms.
            // The loop is non-exiting by construction (a quiet period is NOT a
            // shutdown — that was the "writer task stopped" bug); the managed
            // handle is also Clone + Send, so a broken channel surfaces as a
            // db_exec error and the frontend surfaces a toast, not a hang.
            let w = writer::spawn(handle.clone(), pool.clone());
            handle.manage(w);
            log::info!("single-writer db task started (batch 64 / 200ms)");
            let fk: i64 =
              sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.unwrap_or(0);
            let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
              .fetch_one(&pool)
              .await
              .unwrap_or_default();
            log::info!("sqlite pragmas: foreign_keys={fk} journal_mode={mode}");
            if fk != 1 {
              log::warn!("foreign_keys pragma is OFF — ON DELETE CASCADE will not fire");
            }
            // asset protocol: allow serving files from every stored root
            assets::allow_stored_roots(handle.clone()).await;

            // same roots feed the CORS media server used by the VR dome
            if let Some(srv) = media.clone() {
              srv.refresh(&handle).await;
            }

            restore_watchers(&handle, &pool).await;

            // The frontend gates its first library query on this (S1.10):
            // migrations, writer, asset scope and watchers are all live now.
            handle
              .state::<commands::BackendState>()
              .ready
              .store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = handle.emit("backend-ready", ());
            log::info!("backend ready: writer + asset scope + watchers");
            break;
          }
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
