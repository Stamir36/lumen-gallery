import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { tauriAvailable } from "@/lib/assets";
import type { MediaRow } from "@/lib/api";
import { waitBackendReady } from "@/lib/backend";
import { useViewer } from "@/state/viewer";

/**
 * External open pipeline (Phase 6 STEP 3, P7 F2).
 *
 * LUMEN can receive a media file from the OS in three ways: a CLI argument on
 * first launch, a second launch while running (forwarded by the single-instance
 * plugin), or a drag-and-drop onto the app. All three converge here: resolve
 * the file through Rust (`open_file` builds the folder queue), then open the
 * viewer AT FULLSCREEN immediately, with the normal 2s controls auto-hide.
 * Esc choreography is owned by the viewers: fullscreen first, viewer second.
 *
 * F2: `bootFile` is resolved by main.tsx BEFORE the first render; when present
 * the html gets a `boot-viewer` class (pure black surface, #root hidden) so
 * the gallery never paints for even one frame. The class is removed when the
 * viewer actually mounts; if resolution FAILS we remove it here, otherwise a
 * bad path would brick the boot on a black screen.
 */
export function initExternalOpen(bootFile?: string | null): void {
  if (!tauriAvailable()) return;

  const win = getCurrentWindow();
  let busy = false;

  const clearBootSurface = () =>
    document.documentElement.classList.remove("boot-viewer");

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
      // boot path: never leave the user on a black screen
      clearBootSurface();
    } finally {
      busy = false;
    }
  };

  // second launch / association while running
  void listen<string>("open-file", (e) => void open(e.payload));

  // launched WITH a file argument (first launch): main.tsx already awaited
  // cli_args before the first paint and flipped the boot surface
  if (bootFile) void open(bootFile);

  // drag-and-drop onto the app window opens the dropped file
  void win.onDragDropEvent((e) => {
    if (e.payload.type === "drop" && e.payload.paths.length > 0) {
      void open(e.payload.paths[0]);
    }
  });
}
