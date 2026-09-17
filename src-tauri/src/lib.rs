mod assets;
mod cache;

mod commands;
mod db;
mod scan;
mod thumbs;
mod volumes;
mod watch;

use tauri_plugin_sql::{Migration, MigrationKind};

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
      commands::library_stats,
      commands::cancel_scan,
      cache::thumbnail_cache_size,
      cache::clear_thumbnail_cache,
      thumbs::generate_thumbs,
    ])
    .manage(watch::WatcherRegistry::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
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
            break;
          }
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
