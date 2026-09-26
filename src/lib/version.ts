/** App version — kept in sync with tauri.conf.json / Cargo.toml (0.3.0). */
export const APP_VERSION = "0.3.0";

import { invoke } from "@tauri-apps/api/core";
import { tauriAvailable } from "@/lib/assets";

/** The one place releases are published. */
export const RELEASES_URL = "https://github.com/Stamir36/lumen-gallery/releases";

/**
 * Compare the running version against a GitHub release tag.
 *
 * Three-way verdict on purpose:
 *  - "available" — GitHub is NEWER: offer the update;
 *  - "latest" — equal, or LOCAL is ahead: a development build must never be
 *    told to "update" backwards, silence is the correct answer;
 *  - null — malformed tag: say nothing rather than something wrong.
 */
export function compareWithLatest(
  local: string,
  remoteTag: string,
): "available" | "latest" | null {
  const remote = remoteTag.trim().replace(/^v/i, "");
  if (!/^\d+(\.\d+)*$/.test(remote)) return null;
  const a = local.split(".").map((n) => parseInt(n, 10) || 0);
  const b = remote.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? "latest" : "available";
  }
  return "latest";
}

/**
 * Latest published release tag, or null when GitHub is unreachable.
 *
 * Goes through the Rust `latest_release_tag` command: a HEAD to
 * `releases/latest` follows its redirect, and the tag is read from the final
 * URL. The REST API was dropped on purpose — it is rate-limited per IP, and a
 * shared exit IP (VPN/CGNAT) burns the quota for everyone; the redirect URL
 * has no limit. Outside Tauri (plain browser) there is no IPC, so null.
 */
export async function fetchLatestTag(
  repo = "Stamir36/lumen-gallery",
): Promise<string | null> {
  if (!tauriAvailable()) return null;
  try {
    return await invoke<string>("latest_release_tag", { repo });
  } catch {
    return null;
  }
}
