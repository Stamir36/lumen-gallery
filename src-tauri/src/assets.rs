//! Asset protocol plumbing: local media is rendered ONLY through
//! `convertFileSrc()` on the frontend. Media roots are user-chosen at runtime,
//! so their scope is extended from Rust (config scope covers the thumb cache).
use tauri::{AppHandle, Manager};

/// Allows the asset protocol to serve files under `dir`.
/// NOTE: if a future Tauri release drops the runtime scope API, the fallback is
/// widening `app.security.assetProtocol.scope` to `["**"]` — acceptable for this
/// local-only, offline app (no remote content is ever loaded).
pub fn allow_dir(app: &AppHandle, dir: &std::path::Path) {
    let scope = app.asset_protocol_scope();
    if let Err(e) = scope.allow_directory(dir, true) {
        log::warn!("asset scope allow_directory failed for {dir:?}: {e}");
    }
    // The fs plugin read is the WebView-decoder fallback path (FIX 2): when the
    // Rust image crate cannot decode a file, the frontend fetches its bytes and
    // hands them to createImageBitmap — the fs scope needs the same roots.
    use tauri_plugin_fs::FsExt;
    let fs_scope = app.fs_scope();
    if let Err(e) = fs_scope.allow_directory(dir, true) {
        log::warn!("fs scope allow_directory failed for {dir:?}: {e}");
    }
}

/// Extends the asset scope for every stored root (called once after boot).
pub async fn allow_stored_roots(app: AppHandle) {
    match crate::commands::pool_for(&app).await {
        Ok(pool) => {
            let paths: Vec<String> = sqlx::query_scalar("SELECT path FROM roots")
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
            for p in paths {
                allow_dir(&app, std::path::Path::new(&p));
            }
        }
        Err(e) => log::warn!("asset scope boot pass skipped: {e}"),
    }
}
