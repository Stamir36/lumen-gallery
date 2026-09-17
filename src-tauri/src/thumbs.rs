//! Lazy image thumbnails (Rust side): 480w JPEG q82 + dominant color.
//! Generation runs on a bounded blocking pool (4 workers) and is triggered only
//! for media ids in the grid's visible range — never for a whole root.
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

const THUMB_WIDTH: u32 = 480;
const WORKERS: usize = 4;
const JPEG_QUALITY: u8 = 82;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbResult {
    pub media_id: i64,
    pub thumb_path: Option<String>,
    pub dominant_color: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub ok: bool,
    /// decode failed for good (bad content at this mtime) — render "no preview"
    pub thumb_error: bool,
    pub error: Option<String>,
}

/// Why a render failed, and whether retrying it can ever help.
#[derive(Debug)]
struct RenderFail {
    permanent: bool,
    message: String,
}

impl RenderFail {
    fn permanent(message: String) -> Self {
        Self {
            permanent: true,
            message,
        }
    }

    fn transient(message: String) -> Self {
        Self {
            permanent: false,
            message,
        }
    }
}

fn thumbs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Blocking CPU/IO work: decode → resize → jpeg → dominant color.
fn render(src: &Path, out: &Path) -> Result<(u32, u32, String), RenderFail> {
    // Decode BY CONTENT, never by extension: this library contains mislabeled
    // files (the `Invalid PNG signature` error came from a `.png` that was a
    // JPEG/HEIF payload), and `image::open` trusts the extension.
    let file = std::fs::File::open(src).map_err(|e| RenderFail::transient(format!("open: {e}")))?;
    let reader = image::ImageReader::new(std::io::BufReader::new(file))
        .with_guessed_format()
        .map_err(|e| RenderFail::transient(format!("probe: {e}")))?;
    let img = reader
        .decode()
        .map_err(|e| RenderFail::permanent(format!("decode: {e}")))?;
    let (w, h) = (img.width(), img.height());

    let target_h =
        ((THUMB_WIDTH as f32) * (h as f32) / (w.max(1) as f32)).round() as u32;
    let resized = img.resize(
        THUMB_WIDTH,
        target_h.max(1),
        image::imageops::FilterType::Triangle,
    );

    // dominant color: 4x4 average of the resized thumb
    let small = resized
        .resize(4, 4, image::imageops::FilterType::Triangle)
        .to_rgb8();
    let mut acc = [0u32; 3];
    let count = small.pixels().len().max(1) as u32;
    for p in small.pixels() {
        acc[0] += p[0] as u32;
        acc[1] += p[1] as u32;
        acc[2] += p[2] as u32;
    }
    let dominant = to_hex(
        (acc[0] / count) as u8,
        (acc[1] / count) as u8,
        (acc[2] / count) as u8,
    );

    let mut file = std::fs::File::create(out).map_err(|e| RenderFail::transient(format!("create: {e}")))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, JPEG_QUALITY);
    encoder
        .encode_image(&resized.to_rgb8())
        .map_err(|e| RenderFail::transient(format!("encode: {e}")))?;

    Ok((w, h, dominant))
}

/// What we already know about one row: cached thumb + previous failure.
struct Cached {
    thumb_path: Option<String>,
    thumb_mtime: Option<i64>,
    mtime: i64,
    thumb_error: bool,
}

async fn cached(pool: &SqlitePool, media_id: i64) -> Option<Cached> {
    let row =
        sqlx::query("SELECT thumb_path, thumb_mtime, mtime, thumb_error FROM media WHERE id = ?1")
            .bind(media_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()?;
    Some(Cached {
        thumb_path: row.try_get("thumb_path").ok().flatten(),
        thumb_mtime: row.try_get("thumb_mtime").ok().flatten(),
        mtime: row.try_get("mtime").unwrap_or(0),
        thumb_error: row.try_get::<i64, _>("thumb_error").unwrap_or(0) == 1,
    })
}

/// Generates (or reuses) the thumbnail for one media row.
pub async fn generate_one(
    app: &AppHandle,
    pool: &SqlitePool,
    sem: &Semaphore,
    media_id: i64,
) -> ThumbResult {
    let fail = |error: String| ThumbResult {
        media_id,
        thumb_path: None,
        dominant_color: None,
        width: None,
        height: None,
        ok: false,
        thumb_error: false,
        error: Some(error),
    };

    let src: String = match sqlx::query_scalar("SELECT path FROM media WHERE id = ?1")
        .bind(media_id)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(p)) => p,
        Ok(None) => return fail("unknown media id".into()),
        Err(e) => return fail(e.to_string()),
    };

    if let Some(c) = cached(pool, media_id).await {
        // Known-bad file at an unchanged mtime: never decode it twice and never
        // warn twice. A rescan that touches the file (mtime moves) retries.
        if c.thumb_error && c.thumb_mtime == Some(c.mtime) {
            return ThumbResult {
                media_id,
                thumb_path: None,
                dominant_color: None,
                width: None,
                height: None,
                ok: false,
                thumb_error: true,
                error: Some("decode failed earlier (file unchanged)".into()),
            };
        }
        if let (Some(thumb), Some(thumb_mtime)) = (c.thumb_path.clone(), c.thumb_mtime) {
            if thumb_mtime == c.mtime && Path::new(&thumb).exists() {
                return ThumbResult {
                    media_id,
                    thumb_path: Some(thumb),
                    dominant_color: None,
                    width: None,
                    height: None,
                    ok: true,
                    thumb_error: false,
                    error: None,
                };
            }
        }
    }

    let out = match thumbs_dir(app) {
        Ok(dir) => dir.join(format!("{media_id}.jpg")),
        Err(e) => return fail(e),
    };

    let _permit = match sem.acquire().await {
        Ok(p) => p,
        Err(e) => return fail(format!("worker pool closed: {e}")),
    };

    let src_clone = src.clone();
    let out_clone = out.clone();
    let rendered =
        tauri::async_runtime::spawn_blocking(move || render(Path::new(&src_clone), &out_clone))
            .await
            .unwrap_or_else(|e| Err(RenderFail::transient(format!("worker join: {e}"))));

    match rendered {
        Ok((w, h, dominant)) => {
            let thumb = out.to_string_lossy().to_string();
            let _ = sqlx::query(
                "UPDATE media SET thumb_path = ?1, thumb_mtime = mtime,
                 dominant_color = ?2, thumb_error = 0,
                 width = COALESCE(width, ?3), height = COALESCE(height, ?4)
                 WHERE id = ?5",
            )
            .bind(&thumb)
            .bind(&dominant)
            .bind(w as i64)
            .bind(h as i64)
            .bind(media_id)
            .execute(pool)
            .await;

            ThumbResult {
                media_id,
                thumb_path: Some(thumb),
                dominant_color: Some(dominant),
                width: Some(w as i64),
                height: Some(h as i64),
                ok: true,
                thumb_error: false,
                error: None,
            }
        }
        Err(f) => {
            // exactly one WARN per (file, mtime): the flag below silences the
            // next attempts, so a corrupt file cannot flood the log.
            log::warn!("thumb failed for media {media_id}: {}", f.message);
            if f.permanent {
                let _ = sqlx::query(
                    "UPDATE media SET thumb_error = 1, thumb_mtime = mtime WHERE id = ?1",
                )
                .bind(media_id)
                .execute(pool)
                .await;
            }
            ThumbResult {
                media_id,
                thumb_path: None,
                dominant_color: None,
                width: None,
                height: None,
                ok: false,
                thumb_error: f.permanent,
                error: Some(f.message),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("lumen-thumb-tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn write_jpeg(path: &Path) {
        let img = image::RgbImage::from_fn(64, 48, |x, y| {
            image::Rgb([(x * 4) as u8, (y * 5) as u8, 0x80])
        });
        let mut file = std::fs::File::create(path).unwrap();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut file, image::ImageFormat::Jpeg)
            .unwrap();
    }

    /// The real bug: `image::open` trusted the extension and bailed out with
    /// "Invalid PNG signature" on a file that was actually a JPEG.
    #[test]
    fn decodes_by_content_not_extension() {
        let src = scratch("lie.png");
        let out = scratch("lie.jpg");
        write_jpeg(&src);
        let (w, h, color) = render(&src, &out).unwrap();
        assert_eq!((w, h), (64, 48));
        assert!(color.starts_with('#') && color.len() == 7);
        assert!(out.exists());
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn rejects_non_image_content_as_permanent() {
        let src = scratch("broken.png");
        let out = scratch("broken.jpg");
        std::fs::write(&src, b"this is not an image at all").unwrap();
        let err = render(&src, &out).unwrap_err();
        assert!(err.permanent, "garbage content must not be retried");
        let _ = std::fs::remove_file(&src);
    }
}

/// Command: generate thumbnails for the given (visible-range) media ids.
#[tauri::command]
pub async fn generate_thumbs(app: AppHandle, ids: Vec<i64>) -> Result<Vec<ThumbResult>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let pool = crate::commands::pool_for(&app).await?;
    let sem = std::sync::Arc::new(Semaphore::new(WORKERS));

    let mut handles = Vec::with_capacity(ids.len());
    for id in ids {
        let app = app.clone();
        let pool = pool.clone();
        let sem = sem.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            generate_one(&app, &pool, &sem, id).await
        }));
    }

    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(r) = h.await {
            out.push(r);
        }
    }
    Ok(out)
}