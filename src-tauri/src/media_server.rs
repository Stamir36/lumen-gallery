//! Local CORS media server for the VR dome (FIX 1).
//!
//! WHY: `asset.localhost` responses carry no CORS headers, so a `<video>` that
//! plays fine through the asset protocol TAINTS the canvas — `texImage2D`
//! throws SecurityError and the VR view stays black. Serving the very same file
//! from `http://127.0.0.1:<ephemeral>` with `Access-Control-Allow-Origin: *`
//! plus `crossOrigin="anonymous"` on the element makes the frame CORS-clean.
//!
//! Scope: loopback only, read-only, the path must canonicalize inside a stored
//! (non-excluded) root — the guard runs on every request and never trusts the
//! query string. Range requests are honoured so <video> can seek.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response, StatusCode};

/// Root allow-list, refreshed from SQLite (media roots minus excluded folders).
#[derive(Default)]
pub struct AllowList {
    pub roots: Vec<PathBuf>,
    pub excluded: Vec<PathBuf>,
}

#[derive(Clone)]
pub struct MediaServer {
    pub port: u16,
    allow: Arc<RwLock<AllowList>>,
}

impl MediaServer {
    pub fn url_for(&self, path: &str) -> String {
        format!(
            "http://127.0.0.1:{}/stream?path={}",
            self.port,
            percent_encode(path)
        )
    }

    /// True when `path` is servable: canonical inside a root, not inside an
    /// excluded subtree. The command uses this too, so the frontend can fall
    /// back to a blob URL instead of showing a broken dome.
    pub fn is_allowed(&self, path: &Path) -> bool {
        match self.allow.read() {
            Ok(allow) => is_allowed(path, &allow),
            Err(_) => false,
        }
    }

    /// Re-reads roots + excluded folders. Two tiny queries, called once per
    /// `media_url` request, so the guard can never go stale.
    pub async fn refresh(&self, app: &AppHandle) {
        let pool = match crate::commands::pool_for(app).await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("media server: roots refresh skipped: {e}");
                return;
            }
        };
        let roots: Vec<String> = sqlx::query_scalar("SELECT path FROM roots")
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        let excluded: Vec<String> = sqlx::query_scalar("SELECT path FROM excluded_folders")
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        if let Ok(mut allow) = self.allow.write() {
            allow.roots = roots.iter().map(|p| canon(Path::new(p))).collect();
            allow.excluded = excluded.iter().map(|p| canon(Path::new(p))).collect();
        }
    }
}

/// Canonicalize when possible (missing files fall back to the raw path).
pub fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// `\\?\C:\…` verbatim prefixes break prefix compares on Windows.
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

fn is_allowed(path: &Path, allow: &AllowList) -> bool {
    let target = strip_verbatim(&canon(path));
    if !target.is_file() {
        return false;
    }
    if allow.excluded.iter().any(|b| starts_inside(&target, b)) {
        return false;
    }
    allow.roots.iter().any(|b| starts_inside(&target, b))
}

/// Prefix test that survives `\\?\` verbatim differences on Windows.
fn starts_inside(target: &Path, base: &Path) -> bool {
    target.starts_with(strip_verbatim(&canon(base)))
}

/// Percent-encoding for the `path=` query value (RFC 3986 unreserved set).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for b in s.as_bytes() {
        let c = *b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Decodes %XX (and '+', which some clients send for spaces).
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                if i + 2 >= bytes.len() {
                    return None;
                }
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Content types the WebView2 media stack cares about.
fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mpg" | "mpeg" => "video/mpeg",
        "ts" => "video/mp2t",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes())
        .expect("static header names/values are ASCII")
}

/// CORS headers — without these the canvas stays tainted and VR is black.
fn cors() -> Vec<Header> {
    vec![
        header("Access-Control-Allow-Origin", "*"),
        header("Access-Control-Allow-Methods", "GET, OPTIONS"),
        header("Access-Control-Allow-Headers", "Range, Content-Type"),
        header(
            "Access-Control-Expose-Headers",
            "Content-Range, Accept-Ranges, Content-Length",
        ),
        header("Accept-Ranges", "bytes"),
    ]
}

/// Empty-body response with a header list (`Response::new` is the only builder
/// in tiny_http 0.12 that takes several headers at once).
fn empty_response(status: StatusCode, headers: Vec<Header>) -> Response<std::io::Empty> {
    Response::new(status, headers, std::io::empty(), Some(0), None)
}

/// Starts the loopback server on an ephemeral port; `None` (logged) on failure.
pub fn start() -> Option<MediaServer> {
    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            log::warn!("media server unavailable ({e}) — VR falls back to blob URLs");
            return None;
        }
    };
    let port = match server.server_addr().to_ip() {
        Some(addr) => addr.port(),
        None => {
            log::warn!("media server has no IP address");
            return None;
        }
    };
    let allow = Arc::new(RwLock::new(AllowList::default()));
    let shared = allow.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if let Err(e) = handle(request, &shared) {
                log::warn!("media server request failed: {e}");
            }
        }
    });
    log::info!("media server listening on http://127.0.0.1:{port}");
    Some(MediaServer { port, allow })
}

fn handle(request: Request, allow: &Arc<RwLock<AllowList>>) -> std::io::Result<()> {
    if request.method() == &Method::Options {
        return request.respond(empty_response(StatusCode(204), cors()));
    }
    if request.method() != &Method::Get {
        return request.respond(empty_response(StatusCode(405), cors()));
    }

    let url = request.url().to_string();
    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    let raw = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("path=").or_else(|| kv.strip_prefix("p=")));
    let path = match raw.and_then(percent_decode) {
        Some(p) => PathBuf::from(p),
        None => return request.respond(empty_response(StatusCode(400), cors())),
    };

    let permitted = match allow.read() {
        Ok(a) => is_allowed(&path, &a),
        Err(_) => false,
    };
    if !permitted {
        log::warn!("media server blocked a path outside the library roots");
        return request.respond(empty_response(StatusCode(403), cors()));
    }

    let mut file = std::fs::File::open(&path)?;
    let len = file.metadata()?.len();
    let mime = mime_for(&path);

    // Range: `bytes=start-end`, open-ended end and suffix ranges included.
    let range = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    if len == 0 {
        let mut headers = cors();
        headers.push(header("Content-Type", mime));
        return request.respond(empty_response(StatusCode(200), headers));
    }

    let (start, end) = match range.as_deref().and_then(|r| parse_range(r, len)) {
        Some(r) => r,
        None => (0, len.saturating_sub(1)),
    };
    if start >= len {
        let mut headers = cors();
        headers.push(header("Content-Range", &format!("bytes */{len}")));
        return request.respond(empty_response(StatusCode(416), headers));
    }

    file.seek(SeekFrom::Start(start))?;
    let length = end - start + 1;
    let partial = range.is_some();

    let mut headers = cors();
    headers.push(header("Content-Type", mime));
    if partial {
        headers.push(header("Content-Range", &format!("bytes {start}-{end}/{len}")));
    }
    let status = if partial {
        StatusCode(206)
    } else {
        StatusCode(200)
    };
    let reader = file.take(length);
    request.respond(Response::new(
        status,
        headers,
        reader,
        Some(length as usize),
        None,
    ))
}

/// `bytes=start-end` | `bytes=start-` | `bytes=-suffix` → inclusive bounds.
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if a.is_empty() {
        let suffix: u64 = b.trim().parse().ok()?;
        if suffix == 0 || len == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len - 1));
    }
    let start: u64 = a.trim().parse().ok()?;
    let end = if b.trim().is_empty() {
        len.saturating_sub(1)
    } else {
        b.trim().parse::<u64>().ok()?.min(len.saturating_sub(1))
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

/// Convenience accessor (the state is managed in `lib.rs`).
pub fn server(app: &AppHandle) -> Option<MediaServer> {
    app.try_state::<MediaServer>().map(|s| s.inner().clone())
}