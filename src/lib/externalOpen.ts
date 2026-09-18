import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { tauriAvailable } from "@/lib/assets";
import type { MediaRow } from "@/lib/api";
import { waitBackendReady } from "@/lib/backend";
import { useViewer } from "@/state/viewer";

/**
 * External open pipeline (Phase 6 STEP 3).
 *
 * LUMEN can receive a media file from the OS in three ways: a CLI argument on
 * first launch, a second launch while running (forwarded by the single-instance
 * plugin), or a drag-and-drop onto the app. All three converge here: resolve
 * the file through Rust (`open_file` builds the folder queue), then open the
 * viewer AT FULLSCREEN immediately, with the normal 2s controls auto-hide.
 * Esc choreography is owned by the viewers: fullscreen first, viewer second.
 */
export function initExternalOpen(): void {
  if (!tauriAvailable()) return;

  const win = getCurrentWindow();
  let busy = false;

  const open = async (path: string) => {
    if (busy) return;
    busy = true;
    try {
      await waitBackendReady();
      const res = await invoke<{ row: MediaRow; queue: MediaRow[]; index: number }>(
        "open_file",
        { path },
      );
      // set fullscreen BEFORE opening the overlay: the fade-in plays fullscreen
      const alreadyFs = await win.isFullscreen();
      if (!alreadyFs) await win.setFullscreen(true);
      useViewer.getState().openAt(res.queue, res.index);
    } catch (e) {
      console.error("external open failed:", e);
    } finally {
      busy = false;
    }
  };

  // second launch / association while running
  void listen<string>("open-file", (e) => void open(e.payload));

  // launched WITH a file argument (first launch): wait for readiness once
  void (async () => {
    if (!tauriAvailable()) return;
    try {
      const args: string[] = await invoke("cli_args");
      const file = args.find((a) => a !== "lumen" && /^[A-Za-z]:\\/.test(a));
      if (file) void open(file);
    } catch {
      /* no cli_args (browser QA) — nothing to do */
    }
  })();

  // drag-and-drop onto the app window opens the dropped file
  void win.onDragDropEvent((e) => {
    if (e.payload.type === "drop" && e.payload.paths.length > 0) {
      void open(e.payload.paths[0]);
    }
  });
}
