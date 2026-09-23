//! Background (tray) mode — OPT-IN.
//!
//! Closing the main window only parks the app in the tray when the user asked
//! for it (Settings › System › "Keep running in the tray"); the DEFAULT is the
//! native behavior: closing the window ends the process and frees the WebView2
//! working set.
//!
//! With the mode ON:
//!   - left click on the tray icon → show/focus the window;
//!   - right click → menu: "Open LUMEN" / "Exit" (localized by the frontend,
//!     which passes the labels with every switch).
//!
//! Winning: a second launch (or a double click on an associated file) lands in
//! the warm single instance in milliseconds instead of paying the WebView2 +
//! backend cold start again. Cost: the hidden WebView2 keeps its memory, which
//! is exactly why the default is OFF and the tray menu keeps a real "Exit".

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

/// Tray icon id — one icon, rebuilt on every enable.
const TRAY_ID: &str = "main-tray";

/// Runtime flag the close handler reads. Managed state (AtomicBool, so the
/// window-event callback — which gets `&Window`, not a lock guard — can read it
/// without a mutex).
pub struct TrayMode(pub AtomicBool);

impl Default for TrayMode {
  fn default() -> Self {
    Self(AtomicBool::new(false))
  }
}

/// Is close-to-tray currently armed?
pub fn is_enabled(app: &AppHandle) -> bool {
  app
    .try_state::<TrayMode>()
    .map(|s| s.0.load(Ordering::SeqCst))
    .unwrap_or(false)
}

/// Arm/disarm the mode: store the flag and (un)build the tray icon.
///
/// Labels come from the frontend so the menu follows the app language; a
/// language switch while the mode is on simply calls this again.
pub fn set_enabled(
  app: &AppHandle,
  enabled: bool,
  open_label: &str,
  exit_label: &str,
) -> tauri::Result<()> {
  if let Some(state) = app.try_state::<TrayMode>() {
    state.0.store(enabled, Ordering::SeqCst);
  }
  if enabled {
    build(app, open_label, exit_label)
  } else {
    // drop the icon: a tray presence while the app quits on close would be a
    // lie — and a second icon after a re-enable would be a bug
    app.remove_tray_by_id(TRAY_ID);
    Ok(())
  }
}

fn build(app: &AppHandle, open_label: &str, exit_label: &str) -> tauri::Result<()> {
  // rebuild from scratch: labels may have changed with the language
  app.remove_tray_by_id(TRAY_ID);

  let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", exit_label, true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &quit])?;

  let icon = app
    .default_window_icon()
    .cloned()
    .ok_or(tauri::Error::WindowNotFound)?;

  TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu)
    .show_menu_on_left_click(false)
    .tooltip("LUMEN")
    .icon(icon)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "open" => show_main(app),
      "quit" => {
        log::info!("tray: exit requested");
        // the real exit: the close handler must not park the app again
        if let Some(state) = app.try_state::<TrayMode>() {
          state.0.store(false, Ordering::SeqCst);
        }
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      // left click = show; the menu opens on right click only
      if let tauri::tray::TrayIconEvent::Click {
        button: tauri::tray::MouseButton::Left,
        button_state: tauri::tray::MouseButtonState::Up,
        ..
      } = event
      {
        show_main(tray.app_handle());
      }
    })
    .build(app)?;

  log::info!("tray: background mode armed");
  Ok(())
}

/// Show + focus the main window (shared by the tray click and the menu item).
pub fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}
