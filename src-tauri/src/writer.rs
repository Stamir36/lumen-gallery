//! Single-writer SQLite access.
//!
//! The user-visible symptom was single-row UPDATEs taking 1-7 s during gallery
//! scrolling: several connections issued writes at once, and SQLite serializes
//! writers behind its write lock — so every thumbnail update contended with
//! every other one, and UI writes (favorite) queued behind the whole storm.
//!
//! Contract:
//!  - ALL writes go through ONE tokio task over an mpsc channel;
//!  - thumbnail updates are BATCHED: flush at 200ms or 64 pending items, one
//!    transaction per flush;
//!  - UI-critical writes (favorite, trash, scan bookkeeping) run immediately on
//!    the writer task and complete through a oneshot channel;
//!  - after a committed flush the task emits `thumbs-ready` so tiles can swap
//!    their placeholder the moment the row is durable (S1.3).
//!
//! IMMORTALITY: the first version used `timeout_at(...).unwrap_or_default()`
//! where `None` meant both "timer fired" and "channel closed", so a quiet period
//! killed the task and every later favorite failed with "writer task stopped".
//! The task is now a non-exiting loop driven by `recv()` + an explicit deadline
//! check; a failing flush is retried once with a short backoff and is never
//! fatal for the loop. Regression: `quiet_period_is_not_shutdown`.

use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

const THUMB_FLUSH_INTERVAL: Duration = Duration::from_millis(200);
const THUMB_FLUSH_COUNT: usize = 64;
/// One retry per flush: a transient SQLITE_BUSY must not lose 64 thumb rows.
const FLUSH_RETRY_DELAY: Duration = Duration::from_millis(250);

/// Payload of the `thumbs-ready` event: media ids whose thumbnail is committed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsReady {
    pub ids: Vec<i64>,
}

/// One batched thumbnail success.
///
/// The cache VERSION (`thumb_mtime` + `thumb_size`) is taken from the media row
/// itself inside the UPDATE, never from the caller — a stale size passed by the
/// UI can therefore never mark a thumbnail as current for the wrong file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbOkItem {
    pub media_id: i64,
    pub thumb_path: String,
    pub dominant_color: String,
    /// 0 means "unknown": the column keeps its old value / stays NULL
    pub width: i64,
    pub height: i64,
    pub duration_ms: Option<i64>,
}

pub enum Write {
    /// One immediate statement; the caller waits for the result.
    Immediate {
        sql: String,
        params: Box<[String]>,
        done: oneshot::Sender<Result<u64, String>>,
    },
    /// Batched thumbnail result (from the lazy thumb workers or the webview
    /// video capture).
    ThumbOk(ThumbOkItem),
    /// Batched permanent decode failure: flagged for THIS file version, so a
    /// later change retries it (S1.4) instead of a forever-per-id marker.
    ThumbErr { media_id: i64 },
    /// Cache wipe: forget every thumbnail in one transaction (S1.12 — this used
    /// to run on the pool and contend with the writer).
    ResetThumbs {
        done: oneshot::Sender<Result<u64, String>>,
    },
    /// Watch progress upsert (STEP 2). Fire-and-forget: the player saves every
    /// few seconds and a failure must never interrupt playback.
    Progress {
        media_id: i64,
        position_ms: i64,
        duration_ms: Option<i64>,
    },
    /// Folder exclusion (FIX 5): hide a subtree from every query, and let the
    /// next scan skip it entirely. `exclude = false` is the restore path.
    FolderExclusion {
        root_id: i64,
        path: String,
        exclude: bool,
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
    pub async fn exec(&self, sql: String, params: Vec<String>) -> Result<u64, String> {
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

    pub async fn thumb_ok(&self, item: ThumbOkItem) {
        let _ = self.tx.send(Write::ThumbOk(item)).await;
    }

    pub async fn thumb_err(&self, media_id: i64) {
        let _ = self.tx.send(Write::ThumbErr { media_id }).await;
    }

    /// Resume position for one media item (never awaited by the player).
    pub async fn progress(&self, media_id: i64, position_ms: i64, duration_ms: Option<i64>) {
        let _ = self
            .tx
            .send(Write::Progress {
                media_id,
                position_ms,
                duration_ms,
            })
            .await;
    }

    /// Folder exclusion / restore (FIX 5). Fire-and-forget: the UI refetches.
    pub async fn folder_exclusion(&self, root_id: i64, path: String, exclude: bool) {
        let _ = self
            .tx
            .send(Write::FolderExclusion {
                root_id,
                path,
                exclude,
            })
            .await;
    }

    /// Cache wipe; awaits the transaction so the caller can report real numbers.
    pub async fn reset_thumbs(&self) -> Result<u64, String> {
        let (done, rx) = oneshot::channel();
        self.tx
            .send(Write::ResetThumbs { done })
            .await
            .map_err(|_| "writer task stopped".to_string())?;
        rx.await.map_err(|_| "writer dropped the request".to_string())?
    }
}

/// Spawns the writer task for the app and returns its handle.
pub fn spawn(app: AppHandle, pool: SqlitePool) -> DbWriter {
    spawn_with(Some(app), pool, THUMB_FLUSH_INTERVAL)
}

/// Spawns the writer task. `emitter` is optional so tests can run the loop
/// without a Tauri app; every production path passes a real handle.
pub fn spawn_with(
    emitter: Option<AppHandle>,
    pool: SqlitePool,
    flush_interval: Duration,
) -> DbWriter {
    let (tx, rx) = mpsc::channel::<Write>(4_096);
    tauri::async_runtime::spawn(writer_loop(emitter, pool, rx, flush_interval));
    DbWriter { tx }
}

/// The writer body. NEVER returns while the pool lives: quiet periods are just
/// quiet periods, they are not shutdowns. The only exit is the channel being
/// dropped by every handle holder (app teardown).
async fn writer_loop(
    emitter: Option<AppHandle>,
    pool: SqlitePool,
    mut rx: mpsc::Receiver<Write>,
    flush_interval: Duration,
) {
    // batched thumb writes, keyed by media id (a row may be re-queued)
    let mut thumb_ok: Vec<ThumbOkItem> = Vec::new();
    let mut thumb_err: Vec<i64> = Vec::new();
    let mut deadline: Option<tokio::time::Instant> = None;

    loop {
        let item = if let Some(d) = deadline {
            // batch pending: wait for a message OR the flush deadline.
            // CRITICAL: None here means DEADLINE, not shutdown — a timeout must
            // not terminate the loop (that was the "writer task stopped" bug).
            match tokio::time::timeout_at(d, rx.recv()).await {
                Ok(item) => item,
                Err(_elapsed) => {
                    flush_guarded(emitter.as_ref(), &pool, &mut thumb_ok, &mut thumb_err).await;
                    deadline = None;
                    continue;
                }
            }
        } else {
            rx.recv().await
        };

        let Some(item) = item else { break }; // all handles dropped: real shutdown

        match item {
            Write::ThumbOk(row) => push_thumb_ok(&mut thumb_ok, row),
            Write::ThumbErr { media_id } => {
                if !thumb_err.contains(&media_id) {
                    thumb_err.push(media_id);
                }
            }
            Write::Immediate { sql, params, done } => {
                // UI write: flush the batch first so the immediate statement
                // cannot starve behind pending thumb work
                flush_guarded(emitter.as_ref(), &pool, &mut thumb_ok, &mut thumb_err).await;
                let _ = done.send(run_statement(&pool, &sql, &params).await);
            }
            Write::Progress {
                media_id,
                position_ms,
                duration_ms,
            } => {
                // one tiny upsert, on the writer's connection like every other write
                if let Err(e) = sqlx::query(
                    "INSERT INTO watch_progress (media_id, position_ms, duration_ms, updated_at)
                     VALUES (?1, ?2, ?3, unixepoch())
                     ON CONFLICT(media_id) DO UPDATE SET
                       position_ms = excluded.position_ms,
                       duration_ms = excluded.duration_ms,
                       updated_at  = excluded.updated_at",
                )
                .bind(media_id)
                .bind(position_ms)
                .bind(duration_ms)
                .execute(&pool)
                .await
                {
                    log::warn!("watch progress save failed for media {media_id}: {e}");
                }
            }
            Write::FolderExclusion {
                root_id,
                path,
                exclude,
            } => {
                // ONE transaction: the exclusion row and the media flags must not
                // disagree — an exclusion that hides nothing, or flags with no
                // restore path, is worse than a failed write.
                // substr() (not LIKE/GLOB) so a folder name containing wildcards
                // can never turn into a pattern.
                let res = async {
                    let mut tx = pool.begin().await?;
                    if exclude {
                        sqlx::query(
                            "INSERT OR IGNORE INTO excluded_folders (root_id, path) VALUES (?1, ?2)",
                        )
                        .bind(root_id)
                        .bind(&path)
                        .execute(&mut *tx)
                        .await?;
                    } else {
                        sqlx::query("DELETE FROM excluded_folders WHERE root_id = ?1 AND path = ?2")
                            .bind(root_id)
                            .bind(&path)
                            .execute(&mut *tx)
                            .await?;
                    }
                    let flag: i64 = if exclude { 1 } else { 0 };
                    // placeholders ascend (1,2,3): several drivers bind by the
                    // order the placeholders appear, so ?3-before-?1 is a trap
                    let updated = sqlx::query(
                        "UPDATE media SET excluded = ?1
                          WHERE root_id = ?2
                            AND (path = ?3
                                 OR substr(path, 1, length(?3) + 1) IN (?3 || '\\', ?3 || '/'))",
                    )
                    .bind(flag)
                    .bind(root_id)
                    .bind(&path)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected();
                    tx.commit().await?;
                    Ok::<u64, sqlx::Error>(updated)
                }
                .await;
                match res {
                    Ok(n) => log::info!(
                        "folder {}: {path} ({n} media rows)",
                        if exclude { "excluded" } else { "restored" }
                    ),
                    Err(e) => log::warn!("folder exclusion failed for {path}: {e}"),
                }
            }
            Write::ResetThumbs { done } => {
                flush_guarded(emitter.as_ref(), &pool, &mut thumb_ok, &mut thumb_err).await;
                let res = sqlx::query(
                    "UPDATE media SET thumb_path = NULL, thumb_mtime = NULL,
                     thumb_size = NULL, dominant_color = NULL, thumb_error = 0",
                )
                .execute(&pool)
                .await
                .map(|r| r.rows_affected())
                .map_err(|e| e.to_string());
                let _ = done.send(res);
            }
        }

        if thumb_ok.len() + thumb_err.len() >= THUMB_FLUSH_COUNT {
            flush_guarded(emitter.as_ref(), &pool, &mut thumb_ok, &mut thumb_err).await;
            deadline = None;
        } else if deadline.is_none() && (!thumb_ok.is_empty() || !thumb_err.is_empty()) {
            deadline = Some(tokio::time::Instant::now() + flush_interval);
        }
    }
    // drain on shutdown
    flush_guarded(emitter.as_ref(), &pool, &mut thumb_ok, &mut thumb_err).await;
}

/// Re-queuing the same row replaces the pending entry instead of duplicating it.
fn push_thumb_ok(batch: &mut Vec<ThumbOkItem>, row: ThumbOkItem) {
    match batch.iter_mut().find(|r| r.media_id == row.media_id) {
        Some(slot) => *slot = row,
        None => batch.push(row),
    }
}

async fn run_statement(
    pool: &SqlitePool,
    sql: &str,
    params: &[String],
) -> Result<u64, String> {
    let mut query = sqlx::query(sql);
    for p in params {
        query = query.bind(p);
    }
    query
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .map_err(|e| e.to_string())
}

/// Flush wrapper that contains failures: a bug or a busy database in one batch
/// must not kill the writer (and with it every UI write for the rest of the
/// session). Panics are contained by the spawned task (join error), SQL errors
/// get exactly one retry.
async fn flush_guarded(
    emitter: Option<&AppHandle>,
    pool: &SqlitePool,
    thumb_ok: &mut Vec<ThumbOkItem>,
    thumb_err: &mut Vec<i64>,
) {
    if thumb_ok.is_empty() && thumb_err.is_empty() {
        return;
    }
    let ok = std::mem::take(thumb_ok);
    let err = std::mem::take(thumb_err);
    let ids: Vec<i64> = ok.iter().map(|r| r.media_id).collect();

    let pool2 = pool.clone();
    let ok2 = ok.clone();
    let err2 = err.clone();
    let first = tauri::async_runtime::spawn(async move { flush_inner(&pool2, ok2, err2).await }).await;

    let committed = match first {
        Ok(Ok(())) => true,
        Ok(Err(e)) => {
            log::warn!("thumb batch flush failed ({e}) — retrying once");
            tokio::time::sleep(FLUSH_RETRY_DELAY).await;
            let pool3 = pool.clone();
            match tauri::async_runtime::spawn(async move { flush_inner(&pool3, ok, err).await })
                .await
            {
                Ok(Ok(())) => true,
                Ok(Err(e2)) => {
                    log::error!("thumb batch flush failed twice, dropping the batch: {e2}");
                    false
                }
                Err(join) => {
                    log::error!("thumb batch flush PANICKED on retry: {join}");
                    false
                }
            }
        }
        Err(join) => {
            log::error!("thumb batch flush PANICKED: {join}");
            false
        }
    };

    if committed {
        if let Some(app) = emitter {
            if !ids.is_empty() {
                // durable: the grid may swap placeholders for these ids (S1.3)
                let _ = app.emit("thumbs-ready", ThumbsReady { ids });
            }
        }
    }
}

/// One transaction per flush — 64 updates cost one fsync, not 64.
/// Takes ownership so the guarded wrapper can move it into a spawned task.
async fn flush_inner(
    pool: &SqlitePool,
    mut thumb_ok: Vec<ThumbOkItem>,
    mut thumb_err: Vec<i64>,
) -> Result<(), String> {
    if !thumb_ok.is_empty() {
        let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
        for row in thumb_ok.drain(..) {
            // per-statement failure is logged, never fatal: one bad row must not
            // lose the other 63 updates in the batch
            if let Err(e) = sqlx::query(
                "UPDATE media SET thumb_path = ?1, thumb_mtime = mtime,
                 thumb_size = size, dominant_color = ?2, thumb_error = 0,
                 width = COALESCE(width, NULLIF(?3, 0)),
                 height = COALESCE(height, NULLIF(?4, 0)),
                 duration_ms = COALESCE(duration_ms, ?5)
                 WHERE id = ?6",
            )
            .bind(&row.thumb_path)
            .bind(&row.dominant_color)
            .bind(row.width)
            .bind(row.height)
            .bind(row.duration_ms)
            .bind(row.media_id)
            .execute(&mut *tx)
            .await
            {
                log::error!("thumb update for media {} failed: {e}", row.media_id);
            }
        }
        tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    }

    if !thumb_err.is_empty() {
        let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
        for id in thumb_err.drain(..) {
            // versioned flag: thumb_mtime/thumb_size record the version that
            // failed, so an unchanged file is never decoded twice and a changed
            // one is always retried
            if let Err(e) = sqlx::query(
                "UPDATE media SET thumb_error = 1, thumb_mtime = mtime,
                 thumb_size = size WHERE id = ?1",
            )
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn scratch_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query("CREATE TABLE media (id INTEGER PRIMARY KEY, thumb_path TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO media (id, thumb_path) VALUES (1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// The regression that produced "toggle favorite failed writer task
    /// stopped": a quiet period (the batch flush deadline firing) used to be
    /// indistinguishable from a closed channel and killed the loop.
    #[test]
    fn quiet_period_is_not_shutdown() {
        tauri::async_runtime::block_on(async {
            let pool = scratch_pool().await;
            let writer = spawn_with(None, pool.clone(), Duration::from_millis(30));

            // queue one thumb row, then stay silent long enough for the flush
            // deadline to fire several times
            writer
                .thumb_ok(ThumbOkItem {
                    media_id: 1,
                    thumb_path: "C:/cache/1.jpg".into(),
                    dominant_color: "#101012".into(),
                    width: 480,
                    height: 270,
                    duration_ms: None,
                })
                .await;
            tokio::time::sleep(Duration::from_millis(120)).await;

            // the writer must still answer an immediate UI write
            let affected = writer
                .exec("UPDATE media SET thumb_path = ?1 WHERE id = ?2".into(), vec![
                    "C:/cache/1.jpg".into(),
                    "1".into(),
                ])
                .await
                .expect("writer must still be alive after a quiet period");
            assert_eq!(affected, 1);

            let stored: Option<String> =
                sqlx::query_scalar("SELECT thumb_path FROM media WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(stored.as_deref(), Some("C:/cache/1.jpg"));
        });
    }
}
