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
//! The pool keeps its read connections; only writes are serialized.

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
    let (tx, mut rx) = mpsc::channel::<Write>(4_096);
    tauri::async_runtime::spawn(async move {
        // batched thumb writes, keyed by media id (a row may be re-queued)
        let mut thumb_ok: Vec<(i64, String, String, i64, i64)> = Vec::new();
        let mut thumb_err: Vec<(i64, i64)> = Vec::new();
        let mut flush_at = tokio::time::Instant::now() + THUMB_FLUSH_INTERVAL;

        loop {
            // The "macros" tokio feature is not enabled in this crate, so a
            // manual timeout race replaces tokio::select!: wait for the next
            // message, but never longer than until the batch flush is due.
            let item = if thumb_ok.is_empty() && thumb_err.is_empty() {
                rx.recv().await
            } else {
                // timer fired -> None -> flush below; Some when a message arrives
                tokio::time::timeout_at(flush_at, rx.recv())
                    .await
                    .unwrap_or_default()
            };

            let Some(item) = item else { break }; // channel closed or flush due

            match item {
                Write::ThumbOk { .. } | Write::ThumbErr { .. } => {
                    match item {
                        Write::ThumbOk {
                            media_id,
                            thumb_path,
                            dominant_color,
                            width,
                            height,
                        } => thumb_ok.push((media_id, thumb_path, dominant_color, width, height)),
                        Write::ThumbErr {
                            media_id,
                            thumb_mtime,
                        } => thumb_err.push((media_id, thumb_mtime)),
                        _ => unreachable!(),
                    }
                    if thumb_ok.len() + thumb_err.len() >= THUMB_FLUSH_COUNT {
                        flush(&pool, &mut thumb_ok, &mut thumb_err).await;
                        flush_at = tokio::time::Instant::now() + THUMB_FLUSH_INTERVAL;
                    }
                }
                Write::Immediate { sql, params, done } => {
                    // UI write: flush the batch first so the immediate statement
                    // cannot starve behind pending thumb work
                    flush(&pool, &mut thumb_ok, &mut thumb_err).await;
                    flush_at = tokio::time::Instant::now() + THUMB_FLUSH_INTERVAL;
                    let mut query = sqlx::query(sql);
                    for p in &params {
                        query = query.bind(p);
                    }
                    let res = query
                        .execute(&pool)
                        .await
                        .map(|r| r.rows_affected())
                        .map_err(|e| e.to_string());
                    let _ = done.send(res);
                }
            }

            if thumb_ok.len() + thumb_err.len() >= THUMB_FLUSH_COUNT {
                flush(&pool, &mut thumb_ok, &mut thumb_err).await;
                flush_at = tokio::time::Instant::now() + THUMB_FLUSH_INTERVAL;
            }
        }
        // drain on shutdown
        flush(&pool, &mut thumb_ok, &mut thumb_err).await;
    });

    DbWriter { tx }
}

/// One transaction per flush — 64 updates cost one fsync, not 64.
async fn flush(
    pool: &SqlitePool,
    thumb_ok: &mut Vec<(i64, String, String, i64, i64)>,
    thumb_err: &mut Vec<(i64, i64)>,
) {
    if !thumb_ok.is_empty() {
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                log::error!("thumb batch begin failed: {e}");
                thumb_ok.clear();
                return;
            }
        };
        for (id, path, color, w, h) in thumb_ok.drain(..) {
            let _ = sqlx::query(
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
            .await;
        }
        if let Err(e) = tx.commit().await {
            log::error!("thumb batch commit failed: {e}");
        }
    }

    if !thumb_err.is_empty() {
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                log::error!("thumb error batch begin failed: {e}");
                thumb_err.clear();
                return;
            }
        };
        for (id, mtime) in thumb_err.drain(..) {
            let _ = sqlx::query(
                "UPDATE media SET thumb_error = 1, thumb_mtime = ?1 WHERE id = ?2",
            )
            .bind(mtime)
            .bind(id)
            .execute(&mut *tx)
            .await;
        }
        if let Err(e) = tx.commit().await {
            log::error!("thumb error batch commit failed: {e}");
        }
    }
}

/// Busy timeout for the rare lock wait left (readers vs the single writer).
pub const BUSY_TIMEOUT_MS: i64 = 10_000;
