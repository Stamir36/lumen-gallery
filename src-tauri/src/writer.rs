//! Single-writer SQLite access.
//!
//! The user-visible symptom was single-row UPDATEs taking 1-7 s during gallery
//! scrolling: several connections issued writes at once, and SQLite serializes
//! writers behind its write lock — so every thumbnail update contended with
//! every other one, and UI writes (favorite) queued behind the whole storm.
//!
//! Contract now:
//!  - ALL writes go through ONE tokio task over an mpsc channel;
//!  - thumbnail updates are BATCHED: flush at 200ms or 64 pending items, one
//!    transaction per flush;
//!  - UI-critical writes (favorite, trash, scan bookkeeping) run immediately on
//!    the writer task and complete through a oneshot channel.
//!
//! IMMORTALITY (round 2): the first version used `timeout_at(...).unwrap_or_default()`
//! where `None` meant both "timer fired" and "channel closed", so a quiet period
//! killed the task and every later favorite failed with "writer task stopped".
//! The task is now a non-exiting loop driven by `recv()` + an explicit deadline
//! check; panics in flush are contained; a health-check respawn exists in
//! lib.rs as the last line of defense.

use std::panic::AssertUnwindSafe;
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::sync::{mpsc, oneshot};

const THUMB_FLUSH_INTERVAL: Duration = Duration::from_millis(200);
const THUMB_FLUSH_COUNT: usize = 64;

pub enum Write {
    /// One immediate statement; the caller waits for the result.
    Immediate {
        sql: &'static str,
        params: Box<[String]>,
        done: oneshot::Sender<Result<u64, String>>,
    },
    /// Batched thumbnail result (from the lazy thumb workers).
    ThumbOk {
        media_id: i64,
        thumb_path: String,
        dominant_color: String,
        width: i64,
        height: i64,
    },
    /// Batched permanent decode failure.
    ThumbErr {
        media_id: i64,
        thumb_mtime: i64,
    },
}

/// Handle clones cheaply; every clone feeds the same writer task.
#[derive(Clone)]
pub struct DbWriter {
    pub(crate) tx: mpsc::Sender<Write>,
}

impl DbWriter {
    /// Immediate write that the caller awaits (UI actions keep their latency
    /// contract; a favorite toggle is one queued statement, not one lock fight).
    pub async fn exec(&self, sql: &'static str, params: Vec<String>) -> Result<u64, String> {
        let (done, rx) = oneshot::channel();
        self.tx
            .send(Write::Immediate {
                sql,
                params: params.into_boxed_slice(),
                done,
            })
            .await
            .map_err(|_| "writer task stopped".to_string())?;
        rx.await.map_err(|_| "writer dropped the request".to_string())?
    }

    pub async fn thumb_ok(
        &self,
        media_id: i64,
        thumb_path: String,
        dominant_color: String,
        width: i64,
        height: i64,
    ) {
        let _ = self
            .tx
            .send(Write::ThumbOk {
                media_id,
                thumb_path,
                dominant_color,
                width,
                height,
            })
            .await;
    }

    pub async fn thumb_err(&self, media_id: i64, thumb_mtime: i64) {
        let _ = self.tx.send(Write::ThumbErr { media_id, thumb_mtime }).await;
    }
}

/// Spawns the writer task and returns its handle.
pub fn spawn(pool: SqlitePool) -> DbWriter {
    let (tx, rx) = mpsc::channel::<Write>(4_096);
    tauri::async_runtime::spawn(writer_loop(pool, rx));
    DbWriter { tx }
}

/// The writer body. NEVER returns while the pool lives: quiet periods are just
/// quiet periods, they are not shutdowns. The only exit is the channel being
/// dropped by every handle holder (app teardown).
async fn writer_loop(pool: SqlitePool, mut rx: mpsc::Receiver<Write>) {
    // batched thumb writes, keyed by media id (a row may be re-queued)
    let mut thumb_ok: Vec<(i64, String, String, i64, i64)> = Vec::new();
    let mut thumb_err: Vec<(i64, i64)> = Vec::new();
    let mut deadline: Option<tokio::time::Instant> = None;

    loop {
        let item = if let Some(d) = deadline {
            // batch pending: wait for a message OR the flush deadline.
            // CRITICAL: None here means DEADLINE, not shutdown — a timeout must
            // not terminate the loop (that was the "writer task stopped" bug).
            match tokio::time::timeout_at(d, rx.recv()).await {
                Ok(item) => item,
                Err(_elapsed) => {
                    flush_guarded(&pool, &mut thumb_ok, &mut thumb_err).await;
                    deadline = None;
                    continue;
                }
            }
        } else {
            rx.recv().await
        };

        let Some(item) = item else { break }; // all handles dropped: real shutdown

        match item {
            Write::ThumbOk {
                media_id,
                thumb_path,
                dominant_color,
                width,
                height,
            } => {
                thumb_ok.push((media_id, thumb_path, dominant_color, width, height));
            }
            Write::ThumbErr {
                media_id,
                thumb_mtime,
            } => thumb_err.push((media_id, thumb_mtime)),
            Write::Immediate { sql, params, done } => {
                // UI write: flush the batch first so the immediate statement
                // cannot starve behind pending thumb work
                flush_guarded(&pool, &mut thumb_ok, &mut thumb_err).await;
                let mut query = sqlx::query(sql);
                for p in &params {
                    query = query.bind(p);
                }
                let res = query
                    .execute(&pool)
                    .await
                    .map(|r| r.rows_affected())
                    .map_err(|e| e.to_string());
                // the caller ALWAYS gets an answer — a failed oneshot send means
                // the receiver hung up, never our problem to panic on
                let _ = done.send(res);
            }
        }

        if thumb_ok.len() + thumb_err.len() >= THUMB_FLUSH_COUNT {
            flush_guarded(&pool, &mut thumb_ok, &mut thumb_err).await;
            deadline = None;
        } else if deadline.is_none() && (!thumb_ok.is_empty() || !thumb_err.is_empty()) {
            deadline = Some(tokio::time::Instant::now() + THUMB_FLUSH_INTERVAL);
        }
    }
    // drain on shutdown
    flush_guarded(&pool, &mut thumb_ok, &mut thumb_err).await;
}

/// Flush wrapper that contains panics: a bug in one batch must not kill the
/// writer (and with it every UI write for the rest of the session).
async fn flush_guarded(
    pool: &SqlitePool,
    thumb_ok: &mut Vec<(i64, String, String, i64, i64)>,
    thumb_err: &mut Vec<(i64, i64)>,
) {
    let ok = std::mem::take(thumb_ok);
    let err = std::mem::take(thumb_err);
    let pool = pool.clone();
    // spawned + catch-style join: a panic in one batch is logged and dropped,
    // the writer loop itself keeps serving UI writes
    let res = tauri::async_runtime::spawn(async move {
        let r = AssertUnwindSafe(flush_inner(&pool, ok, err)).await;
        r
    })
    .await;
    match res {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::error!("thumb batch flush failed: {e}"),
        Err(join) => log::error!("thumb batch flush PANICKED: {join}"),
    }
}

/// One transaction per flush — 64 updates cost one fsync, not 64.
/// Takes ownership so the guarded wrapper can move it into a spawned task.
async fn flush_inner(
    pool: &SqlitePool,
    mut thumb_ok: Vec<(i64, String, String, i64, i64)>,
    mut thumb_err: Vec<(i64, i64)>,
) -> Result<(), String> {
    if !thumb_ok.is_empty() {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("begin: {e}"))?
            ;
        for (id, path, color, w, h) in thumb_ok.drain(..) {
            // per-statement failure is logged, never fatal: one bad row must not
            // lose the other 63 updates in the batch
            if let Err(e) = sqlx::query(
                "UPDATE media SET thumb_path = ?1, thumb_mtime = mtime,
                 dominant_color = ?2, thumb_error = 0,
                 width = COALESCE(width, ?3), height = COALESCE(height, ?4)
                 WHERE id = ?5",
            )
            .bind(&path)
            .bind(&color)
            .bind(w)
            .bind(h)
            .bind(id)
            .execute(&mut *tx)
            .await
            {
                log::error!("thumb update for media {id} failed: {e}");
            }
        }
        tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    }

    if !thumb_err.is_empty() {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("begin: {e}"))?
            ;
        for (id, mtime) in thumb_err.drain(..) {
            if let Err(e) = sqlx::query(
                "UPDATE media SET thumb_error = 1, thumb_mtime = ?1 WHERE id = ?2",
            )
            .bind(mtime)
            .bind(id)
            .execute(&mut *tx)
            .await
            {
                log::error!("thumb_error update for media {id} failed: {e}");
            }
        }
        tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    }
    Ok(())
}

/// Busy timeout for the rare lock wait left (readers vs the single writer).
pub const BUSY_TIMEOUT_MS: i64 = 10_000;
