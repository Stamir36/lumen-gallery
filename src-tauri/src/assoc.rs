//! Opt-in file associations (Phase 6 STEP 4) — Windows, HKCU ONLY.
//!
//! Compliance contract:
//!  - every write lives under HKEY_CURRENT_USER (no admin, never HKLM);
//!  - LUMEN is added to the "Open with" LIST via `OpenWithProgids` — the OS
//!    default is NEVER taken silently: `UserChoice` is hash-protected by
//!    Windows and writing it is hijacking, so this code does not even look
//!    at it. Making LUMEN the default stays a user action in Windows
//!    Settings (the UI offers the `ms-settings:defaultapps` shortcut);
//!  - every written key/value goes into a manifest stored in the settings
//!    kv through the single writer — unregister deletes EXACTLY those
//!    entries, nothing else;
//!  - an uninstaller `.reg` file with DELETE lines is written next to the
//!    manifest so a deleted portable build leaves zero traces;
//!  - idempotent: registering twice rewrites the same values.

#![cfg(windows)]

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Settings kv write through the SINGLE WRITER (same path as db_exec — S1.12).
async fn set_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let writer = app
        .try_state::<crate::writer::DbWriter>()
        .ok_or("db writer is not ready yet")?;
    writer
        .exec(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)\n             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                .into(),
            vec![key.into(), value.into()],
        )
        .await
        .map(|_| ())
}

/// Settings kv read — reads never contend, the pool is fine (S1.12 covers writes).
async fn read_setting(app: &AppHandle, key: &str) -> Option<String> {
    let pool = crate::commands::pool_for(app).await.ok()?;
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
}

/// Extensions LUMEN offers itself for (mirrors the scan whitelist + extras).
pub const EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "mp4", "mkv", "webm", "mov", "m4v",
];

const PROGID: &str = "Lumen.Media";
const MANIFEST_KEY: &str = "assoc_manifest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssocStatus {
    pub registered: bool,
    /// exe path the registration points at (None when unregistered)
    pub registered_exe: Option<String>,
    /// current exe differs from the registered one — offer re-registration
    pub path_drift: bool,
    /// path of the generated lumen-unregister.reg (None when unregistered)
    pub reg_file: Option<String>,
}

fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Where the uninstaller .reg lives (appDataDir — per identifier, survives
/// updates, removed with the data).
fn reg_file_path(app: &AppHandle) -> Option<String> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("lumen-unregister.reg").to_string_lossy().to_string())
}

// ---------- low-level registry helpers (winreg) ----------

fn open_root() -> Result<winreg::RegKey, String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Classes")
        .map(|(k, _)| k)
        .map_err(|e| e.to_string())
}

/// Manifest entries as `key\0\0value-name` (empty value name = "(Default)").
#[derive(serde::Serialize, serde::Deserialize)]
struct Manifest(Vec<String>);

async fn write_manifest(app: &AppHandle, entries: Vec<String>) -> Result<(), String> {
    set_setting(
        app,
        MANIFEST_KEY,
        &serde_json::to_string(&Manifest(entries)).map_err(|e| e.to_string())?,
    )
    .await
}

async fn read_manifest(app: &AppHandle) -> Manifest {
    read_setting(app, MANIFEST_KEY)
        .await
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Manifest(Vec::new()))
}

// ---------- public commands ----------

#[tauri::command]
pub async fn assoc_status(app: AppHandle) -> AssocStatus {
    status(&app).await
}

async fn status(app: &AppHandle) -> AssocStatus {
    let registered = read_setting(app, "assoc_registered")
        .await
        .map(|v| v == "true")
        .unwrap_or(false);
    let registered_exe = read_setting(app, "assoc_exe")
        .await
        .filter(|s| !s.is_empty());
    let path_drift = registered && registered_exe.as_deref() != Some(exe_path().as_str());
    AssocStatus {
        registered,
        registered_exe,
        path_drift,
        reg_file: if registered { reg_file_path(app) } else { None },
    }
}

/// Register: ProgId + OpenWithProgids values, manifest + uninstaller .reg.
#[tauri::command]
pub async fn assoc_register(app: AppHandle) -> Result<AssocStatus, String> {
    let exe = exe_path();
    if exe.is_empty() {
        return Err("cannot resolve the executable path".into());
    }
    let root = open_root()?;
    let mut entries: Vec<String> = Vec::new();

    // a) ProgId tree
    let pid = root.create_subkey(PROGID).map_err(|e| e.to_string())?.0;
    pid.set_value("", &"LUMEN media").map_err(|e| e.to_string())?;
    entries.push(format!("{PROGID}\u{0}\u{0}"));
    let default_icon = format!("\"{exe}\",0");
    pid.set_value("DefaultIcon", &default_icon).map_err(|e| e.to_string())?;
    entries.push(format!("{PROGID}\u{0}DefaultIcon"));
    let shell = root.create_subkey(format!("{PROGID}\\shell\\open\\command")).map_err(|e| e.to_string())?.0;
    let cmd = format!("\"{exe}\" \"%1\"");
    shell.set_value("", &cmd).map_err(|e| e.to_string())?;
    entries.push(format!("{PROGID}\\shell\\open\\command\u{0}\u{0}"));

    // b) per-extension OpenWithProgids value — adds LUMEN to "Open with",
    //    never takes the default
    for ext in EXTENSIONS {
        let key = format!(".{ext}\\OpenWithProgids");
        let k = root.create_subkey(&key).map_err(|e| e.to_string())?.0;
        // "empty bytes" per contract: REG_NONE-ish empty string value
        k.set_value(PROGID, &"").map_err(|e| e.to_string())?;
        entries.push(format!("{key}\u{0}{PROGID}"));
    }

    write_manifest(&app, entries).await?;
    set_setting(&app, "assoc_registered", "true").await?;
    set_setting(&app, "assoc_exe", &exe).await?;
    write_uninstall_reg(&app).await?;
    log::info!("associations registered (OpenWithProgids, HKCU only)");
    Ok(status(&app).await)
}

/// Unregister: delete EXACTLY the manifest entries; report what stayed.
#[tauri::command]
pub async fn assoc_unregister(app: AppHandle) -> Result<AssocStatus, String> {
    let root = open_root()?;
    let Manifest(entries) = read_manifest(&app).await;
    for e in entries {
        let (key, value) = match e.split_once('\u{0}') {
            Some((k, v)) => (k, v),
            None => (e.as_str(), ""),
        };
        if value.is_empty() {
            // whole key (ProgId tree) — delete from the parent; a top-level key
            // ("Lumen.Media" itself) has no parent segment and goes to the root
            match key.rsplit_once('\\') {
                Some((parent, leaf)) => {
                    if let Ok(p) = root.open_subkey(parent) {
                        let _ = p.delete_subkey(leaf);
                    }
                }
                None => {
                    let _ = root.delete_subkey(key);
                }
            }
        } else if let Ok(k) = root.open_subkey(key) {
            let _ = k.delete_value(value);
        }
    }
    set_setting(&app, "assoc_registered", "false").await?;
    set_setting(&app, "assoc_exe", "").await?;
    log::info!("associations unregistered (manifest entries only)");
    Ok(status(&app).await)
}

/// The generated .reg holds DELETE lines for exactly the manifest keys —
/// double-clicking it removes every trace after a portable build is deleted.
async fn write_uninstall_reg(app: &AppHandle) -> Result<(), String> {
    let Some(path) = reg_file_path(app) else { return Ok(()) };
    let Manifest(entries) = read_manifest(app).await;
    let mut body = String::from("Windows Registry Editor Version 5.00\r\n\r\n; LUMEN uninstaller — deletes exactly what LUMEN registered (HKCU only)\r\n\r\n");
    // ORDER MATTERS: value deletes run while the key exists, whole-key deletes
    // go last (a key with both ends deleted entirely — net zero trace).
    let mut value_block = String::new();
    let mut key_block = String::new();
    let mut seen = std::collections::HashSet::new();
    for e in &entries {
        let (key, value) = match e.split_once('\u{0}') {
            Some((k, v)) => (k, v),
            None => (e.as_str(), ""),
        };
        if value.is_empty() {
            if seen.insert(format!("-{key}")) {
                key_block.push_str(&format!("[-HKEY_CURRENT_USER\\{key}]\r\n\r\n"));
            }
        } else if seen.insert(key.to_string()) {
            value_block.push_str(&format!("[HKEY_CURRENT_USER\\{key}]\r\n"));
            value_block.push_str(&format!("\"{value}\"=-\r\n\r\n"));
        }
    }
    body.push_str(&value_block);
    body.push_str(&key_block);
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

/// Open Windows Settings > Default apps (the user assigns defaults there).
#[tauri::command]
pub fn assoc_open_settings() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
