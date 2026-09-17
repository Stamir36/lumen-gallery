import { convertFileSrc } from "@tauri-apps/api/core";

/** True inside the Tauri webview, false in a plain browser (dev QA routes). */
export function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The ONLY way LUMEN renders a local file in the webview.
 * Requires the asset protocol (enabled in tauri.conf.json) plus a scope entry
 * for the file's root directory (extended at runtime from Rust on add_root/boot).
 */
export function fileSrc(path: string): string {
  // No IPC (browser preview): an empty src keeps <video> inert instead of
  // throwing "convertFileSrc of undefined" all over the console.
  if (!tauriAvailable()) return "";
  return convertFileSrc(path);
}