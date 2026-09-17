import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tauriAvailable } from "@/lib/assets";

/**
 * Backend-ready gate (S1.10).
 *
 * Rust resolves the SQLite pool lazily (up to ~15s of retries) and only then
 * sets the pragmas, spawns the single-writer task, extends the asset scope and
 * restores the fs watchers. Queries fired before that raced all of it: that is
 * the first-open flicker (empty tiles, "file:/// not allowed", a favourite that
 * fails once). The window now waits for the signal — but the signal can also
 * have fired BEFORE the listener attached, so the flag is probed both first and
 * once more after subscribing.
 */
export async function waitBackendReady(timeoutMs = 20_000): Promise<boolean> {
  if (!tauriAvailable()) return true; // browser QA route: no Rust backend

  const probe = async () => {
    try {
      return (await invoke<boolean>("backend_ready")) === true;
    } catch {
      return false; // command not reachable yet — the event will tell us
    }
  };

  if (await probe()) return true;

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(to);
      resolve(ok);
    };
    const to = window.setTimeout(() => {
      // a timeout must not dead-lock the library: load anyway and let the
      // queries surface their own errors
      console.warn("backend-ready timed out — loading the library anyway");
      finish(false);
    }, timeoutMs);
    void listen("backend-ready", () => finish(true));
    // race: it became ready between the probe and the subscription
    void probe().then((ok) => {
      if (ok) finish(true);
    });
  });
}
