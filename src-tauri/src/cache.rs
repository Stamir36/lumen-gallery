//! Cache operations are restricted to generated thumbnails, never library files.
use std::fs;
use tauri::{AppHandle, Manager};

fn thumbnails(app: &AppHandle, clear: bool) -> Result<u64, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    let metadata = match fs::symlink_metadata(&dir) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("invalid thumbnail cache directory".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("cache reparse points are not supported".into());
        }
    }
    let mut bytes = 0;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file()
            || !entry
                .path()
                .extension()
                .is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("webp") || ext.eq_ignore_ascii_case("jpg")
                })
        {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 { continue; }
        }
        bytes += metadata.len();
        if clear { fs::remove_file(entry.path()).map_err(|e| e.to_string())?; }
    }
    Ok(bytes)
}

#[tauri::command]
pub fn thumbnail_cache_size(app: AppHandle) -> Result<u64, String> {
    thumbnails(&app, false)
}

#[tauri::command]
pub async fn clear_thumbnail_cache(app: AppHandle) -> Result<u64, String> {
    let bytes = thumbnails(&app, true)?;
    // The rows must forget the thumbnails as well: otherwise the grid keeps
    // pointing at files that no longer exist (and keeps showing a stale, e.g.
    // black, video frame) and never regenerates them. Through the SINGLE WRITER
    // (S1.12): a direct pool write here used to contend with the very thumbnail
    // batch this call is cancelling.
    use tauri::Manager;
    if let Some(writer) = app.try_state::<crate::writer::DbWriter>() {
        match writer.inner().reset_thumbs().await {
            Ok(rows) => log::info!("thumbnail cache wiped: {rows} rows reset"),
            Err(e) => log::error!("thumbnail cache row reset failed: {e}"),
        }
    }
    Ok(bytes)
}
