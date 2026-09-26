//! Mobile stand-ins for the two desktop-only modules (`tray`, `assoc`).
//!
//! Android and iOS have no tray icon and no HKCU registry, but the command
//! names in `invoke_handler` and the state/managed types must still exist so
//! the crate compiles without a single `#[cfg]` inside the shared code.
//! Everything here answers "not available on this platform" and nothing else —
//! the desktop implementations are untouched in `tray.rs` / `assoc.rs`.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;

// ------------------------------- tray -----------------------------------

/// Same shape as `tray::TrayMode`, permanently OFF: there is no tray to park in.
pub struct TrayMode(pub AtomicBool);

impl Default for TrayMode {
    fn default() -> Self {
        TrayMode(AtomicBool::new(false))
    }
}

/// A mobile app is always "in the tray" in the OS sense — there is nothing to
/// restore, so the close-request hook never parks the window.
pub fn is_enabled(_app: &AppHandle) -> bool {
    false
}

/// Kept for signature parity; switching background mode off is a no-op here.
pub fn set_enabled(
    _app: &AppHandle,
    enabled: bool,
    _open_label: &str,
    _exit_label: &str,
) -> Result<(), String> {
    if enabled {
        return Err("background mode (tray) is desktop-only".into());
    }
    Ok(())
}

/// Nothing to raise on a single-window platform.
pub fn show_main(_app: &AppHandle) {}

// ------------------------------- assoc ----------------------------------

/// File associations on mobile are declared in the app bundle (Android
/// intent-filters), never written to a registry from code.
#[tauri::command]
pub fn assoc_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "supported": false, "registered": [] }))
}

#[tauri::command]
pub fn assoc_register() -> Result<(), String> {
    Err("file associations are declared in the app manifest on this platform".into())
}

#[tauri::command]
pub fn assoc_unregister() -> Result<(), String> {
    Err("file associations are declared in the app manifest on this platform".into())
}

#[tauri::command]
pub fn assoc_open_settings() -> Result<(), String> {
    Err("the default-apps page is desktop-only".into())
}

/// Mobile callers must read the flag as OFF; kept so shared code compiles.
pub fn tray_flag_is_on(app: &AppHandle) -> bool {
    let _ = Ordering::SeqCst;
    is_enabled(app)
}
