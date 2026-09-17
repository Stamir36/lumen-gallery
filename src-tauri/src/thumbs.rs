//! Lazy image thumbnails (Rust side): 480w JPEG q82 + dominant color.
//!
//! Generation is triggered only for media ids in the grid's visible range —
//! never for a whole root. The worker pool is APP-WIDE (S1.2): one semaphore per
//! process, sized by the `thumb_workers` setting (default 4), so ten overlapping
//! requests can no longer start ten decoder storms. Requests are split into
//! sub-batches and every finished row is pushed to the UI immediately
//! (`thumb-result`), so the first cold tiles appear long before the last one.
//!
//! Cache validity is keyed by FILE VERSION (S1.4): `(mtime, size)`. A file that
//! was replaced under the same mtime, or a row that previously failed to decode,
//! is re-rendered instead of serving a stale/negative entry forever.
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use crate::writer::{DbWriter, ThumbOkItem};

const THUMB_WIDTH: u32 = 480;
const DEFAULT_WORKERS: usize = 4;
const MAX_WORKERS: usize = 16;
const JPEG_QUALITY: u8 = 82;
/// One request is processed in sub-batches of this size so results stream.
const SUB_BATCH: usize = 24;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbResult {
    pub media_id: i64,
    pub thumb_path: Option<String>,
    pub dominant_color: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub ok: bool,
    /// decode failed for good (bad content at this version) — render "no preview"
    pub thumb_error: bool,
    pub error: Option<String>,
}

/// App-wide thumbnail engine (managed state).
///
/// `workers` holds the current permit count + semaphore; `inflight` dedupes ids
/// so the same row queued twice (two mounted cards, two calls) is decoded once.
#[derive(Clone, Default)]
pub struct ThumbEngine {
    inner: Arc<EngineInner>,
}

struct EngineInner {
    workers: Mutex<(usize, Arc<Semaphore>)>,
    inflight: Mutex<HashSet<i64>>,
}

impl Default for EngineInner {
    fn default() -> Self {
        // `Semaphore` has no Default: start at the default worker count so the
        // first request does not needlessly rebuild the pool.
        Self {
            workers: Mutex::new((
                DEFAULT_WORKERS,
                Arc::new(Semaphore::new(DEFAULT_WORKERS)),
            )),
            inflight: Mutex::new(HashSet::new()),
        }
    }
}

impl ThumbEngine {
    /// The shared semaphore, rebuilt only when the setting changes.
    async fn semaphore(&self, pool: &SqlitePool) -> Arc<Semaphore> {
        let want = workers_setting(pool).await;
        let mut guard = self.inner.workers.lock().unwrap();
        if guard.0 != want {
            *guard = (want, Arc::new(Semaphore::new(want)));
        }
        guard.1.clone()
    }

    /// false when this media id is already being decoded somewhere.
    fn claim(&self, id: i64) -> bool {
        self.inner.inflight.lock().unwrap().insert(id)
    }

    fn release(&self, id: i64) {
        self.inner.inflight.lock().unwrap().remove(&id);
    }
}

/// `thumb_workers` (Settings › Performance) — clamped, default 4.
async fn workers_setting(pool: &SqlitePool) -> usize {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'thumb_workers'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    raw.and_then(|v| v.trim().parse::<usize>().ok())
        .map(|v| v.clamp(1, MAX_WORKERS))
        .unwrap_or(DEFAULT_WORKERS)
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

    let mut file =
        std::fs::File::create(out).map_err(|e| RenderFail::transient(format!("create: {e}")))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, JPEG_QUALITY);
    encoder
        .encode_image(&resized.to_rgb8())
        .map_err(|e| RenderFail::transient(format!("encode: {e}")))?;

    Ok((w, h, dominant))
}

/// What we already know about one row: cached thumb + the version it belongs to.
struct Cached {
    thumb_path: Option<String>,
    thumb_mtime: Option<i64>,
    thumb_size: Option<i64>,
    mtime: i64,
    size: i64,
    thumb_error: bool,
}

impl Cached {
    /// The cached entry belongs to the file we are looking at right now.
    fn version_matches(&self) -> bool {
        self.thumb_mtime == Some(self.mtime) && self.thumb_size == Some(self.size)
    }
}

async fn cached(pool: &SqlitePool, media_id: i64) -> Option<Cached> {
    let row = sqlx::query(
        "SELECT thumb_path, thumb_mtime, thumb_size, mtime, size, thumb_error
         FROM media WHERE id = ?1",
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;
    Some(Cached {
        thumb_path: row.try_get("thumb_path").ok().flatten(),
        thumb_mtime: row.try_get("thumb_mtime").ok().flatten(),
        thumb_size: row.try_get("thumb_size").ok().flatten(),
        mtime: row.try_get("mtime").unwrap_or(0),
        size: row.try_get("size").unwrap_or(0),
        thumb_error: row.try_get::<i64, _>("thumb_error").unwrap_or(0) == 1,
    })
}

/// Generates (or reuses) the thumbnail for one media row.
pub async fn generate_one(
    app: &AppHandle,
    pool: &SqlitePool,
    sem: &Semaphore,
    media_id: i64,
    writer: &DbWriter,
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

    let cached_row = cached(pool, media_id).await;
    if let Some(c) = &cached_row {
        // Known-bad file at an UNCHANGED version: never decode it twice and never
        // warn twice. A rescan that touches the file (mtime or size moves)
        // retries it — the flag is versioned, not permanent.
        if c.thumb_error && c.version_matches() {
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
        if let Some(thumb) = c.thumb_path.clone() {
            if c.version_matches() && Path::new(&thumb).exists() {
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
            // stale (file changed, or the cache was wiped): drop the old file so
            // the cache cannot grow orphans, then re-render below
            if !c.version_matches() {
                let _ = std::fs::remove_file(&thumb);
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
            // batched by the writer task (one transaction per 200ms / 64 items):
            // a scroll session no longer fires hundreds of single-row writes
            writer
                .thumb_ok(ThumbOkItem {
                    media_id,
                    thumb_path: thumb.clone(),
                    dominant_color: dominant.clone(),
                    width: w as i64,
                    height: h as i64,
                    duration_ms: None,
                })
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
            // exactly one WARN per (file, version): the flag below silences the
            // next attempts, so a corrupt file cannot flood the log.
            log::warn!("thumb failed for media {media_id}: {}", f.message);
            if f.permanent {
                writer.thumb_err(media_id).await;
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

    /// Version keying: a thumbnail rendered from a file with the same mtime but
    /// a different size is stale and must NOT be reused.
    #[test]
    fn cache_version_needs_mtime_and_size() {
        let current = Cached {
            thumb_path: Some("t.jpg".into()),
            thumb_mtime: Some(1_000),
            thumb_size: Some(5_000),
            mtime: 1_000,
            size: 5_000,
            thumb_error: false,
        };
        assert!(current.version_matches());

        let replaced = Cached {
            size: 9_000,
            ..current
        };
        assert!(!replaced.version_matches(), "same mtime + new size = stale");
    }
}

/// Command: generate thumbnails for the given (visible-range) media ids.
///
/// Results are ALSO pushed one-by-one as `thumb-result` events, so a tile paints
/// as soon as its row is done instead of waiting for the whole request (S1.2).
#[tauri::command]
pub async fn generate_thumbs(
    app: AppHandle,
    engine: tauri::State<'_, ThumbEngine>,
    ids: Vec<i64>,
) -> Result<Vec<ThumbResult>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let pool = crate::commands::pool_for(&app).await?;
    let writer = app.state::<DbWriter>().inner().clone();
    let sem = engine.semaphore(&pool).await;
    let engine = engine.inner().clone();

    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(SUB_BATCH) {
        let mut handles = Vec::with_capacity(chunk.len());
        for id in chunk {
            // the same row queued twice (two mounted cards, two calls) is
            // decoded once — the engine owns the in-flight set
            if !engine.claim(*id) {
                continue;
            }
            let app = app.clone();
            let pool = pool.clone();
            let sem = sem.clone();
            let writer = writer.clone();
            let engine = engine.clone();
            let id = *id;
            handles.push(tauri::async_runtime::spawn(async move {
                let res = generate_one(&app, &pool, &sem, id, &writer).await;
                engine.release(id);
                let _ = app.emit("thumb-result", res.clone());
                res
            }));
        }
        for h in handles {
            if let Ok(r) = h.await {
                out.push(r);
            }
        }
    }
    Ok(out)
}
