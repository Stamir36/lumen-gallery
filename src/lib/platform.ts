/**
 * Platform detection for the shell.
 *
 * LUMEN is primarily a Windows desktop app; the Android build reuses the same
 * screens. Two things are desktop-only and must not render on a phone:
 *
 *  1. **Window chrome** — a frameless window with minimize/maximize/close is a
 *     desktop idea; on Android the OS owns those buttons (`WindowTitleBar`).
 *  2. **Window dragging** — `startDragging()` is a no-op there, and the drag
 *     strip swallows touches that should scroll the grid.
 *
 * Detection is deliberately conservative: the WebView user agent is the only
 * signal available before any IPC call, and getting it wrong in the desktop
 * direction (hiding chrome on Windows) would be worse than a stray titlebar on
 * a phone. `isMobile` is therefore true only for a clear Android/iOS UA.
 */

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const isAndroid = /Android/i.test(ua);
export const isIOS = /iPhone|iPad|iPod/i.test(ua);
export const isMobile = isAndroid || isIOS;

/** Desktop chrome (window controls, drag strip, tray-related rows) is shown. */
export const isDesktop = !isMobile;
