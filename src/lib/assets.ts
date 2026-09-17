import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * The ONLY way LUMEN renders a local file in the webview.
 * Requires the asset protocol (enabled in tauri.conf.json) plus a scope entry
 * for the file's root directory (extended at runtime from Rust on add_root/boot).
 */
export function fileSrc(path: string): string {
  return convertFileSrc(path);
}