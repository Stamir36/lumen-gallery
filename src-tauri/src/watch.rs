//! Watcher lifecycle: one notify watcher per root, held in a registry so
//! `remove_root` can stop and drop the thread instead of leaving zombie
//! rescans pointing at a deleted root_id.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::AppHandle;

use crate::scan;

/// Stop signal + join handle for a watcher thread.
pub struct WatcherHandle {
    stop: std::sync::mpsc::Sender<()>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl WatcherHandle {
    pub fn stop(mut self) {
        let _ = self.stop.send(());
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Global registry: root_id -> watcher handle. Managed as Tauri state.
#[derive(Default)]
pub struct WatcherRegistry {
    inner: Mutex<HashMap<i64, WatcherHandle>>,
}

impl WatcherRegistry {
    /// Stops and removes the watcher for `root_id` (no-op if absent).
    pub fn remove(&self, root_id: i64) {
        if let Some(handle) = self.inner.lock().unwrap().remove(&root_id) {
            handle.stop();
        }
    }

    /// Inserts a fresh handle, stopping any previous one for this root.
    fn insert(&self, root_id: i64, handle: WatcherHandle) {
        if let Some(prev) = self.inner.lock().unwrap().insert(root_id, handle) {
            prev.stop();
        }
    }
}

/// Spawns the debounced (2s) rescan watcher thread for a root and registers it.
/// Exits promptly when `remove_root` signals stop.
pub fn spawn_watcher(
    app: AppHandle,
    pool: SqlitePool,
    registry: &WatcherRegistry,
    root_id: i64,
    root_path: PathBuf,
) {
    use notify::{RecursiveMode, Watcher};

    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let (event_tx, event_rx) = std::sync::mpsc::channel::<()>();

    let join = std::thread::spawn(move || {
        let mut watcher = match notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if res.is_ok() {
                    let _ = event_tx.send(());
                }
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("watcher init failed for {root_path:?}: {e}");
                return;
            }
        };

        if let Err(e) = watcher.watch(&root_path, RecursiveMode::Recursive) {
            log::warn!("watch failed for {root_path:?}: {e}");
            return;
        }

        // mpsc has no select: poll the stop channel with short recv timeouts.
        let tick = Duration::from_millis(200);
        let debounce = Duration::from_secs(2);
        let stopped = |rx: &std::sync::mpsc::Receiver<()>| rx.try_recv().is_ok();

        loop {
            // Wait for the first fs event, checking stop every 200ms.
            let mut waited = Duration::ZERO;
            let got_event = loop {
                if stopped(&stop_rx) {
                    return;
                }
                match event_rx.recv_timeout(tick) {
                    Ok(()) => break true,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        waited += tick;
                        if waited >= debounce {
                            break false;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            };
            if !got_event {
                continue;
            }
            if stopped(&stop_rx) {
                return;
            }

            // Coalesce further events for the debounce window.
            waited = Duration::ZERO;
            loop {
                if stopped(&stop_rx) {
                    return;
                }
                match event_rx.recv_timeout(tick) {
                    Ok(()) => waited = Duration::ZERO,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        waited += tick;
                        if waited >= debounce {
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if stopped(&stop_rx) {
                return;
            }

            let app2 = app.clone();
            let pool2 = pool.clone();
            let path2 = root_path.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = scan::scan_root(&app2, &pool2, root_id, &path2).await {
                    log::warn!("incremental rescan failed: {e}");
                }
            });
        }
    });

    registry.insert(
        root_id,
        WatcherHandle {
            stop: stop_tx,
            join: Some(join),
        },
    );
}
