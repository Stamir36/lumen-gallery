mod cache;

mod commands;
mod db;
mod scan;
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
  ];

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
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
      cache::thumbnail_cache_size,
      cache::clear_thumbnail_cache,
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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
