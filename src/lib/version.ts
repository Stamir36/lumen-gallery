/** App version — kept in sync with tauri.conf.json / Cargo.toml (0.2.0). */
export const APP_VERSION = "0.2.0";

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
 * The releases API sends `Access-Control-Allow-Origin: *`, so a webview fetch
 * works — but it is rate-limited per IP (60/h unauthenticated), which a shared
 * network can burn without us. That case degrades gracefully in the UI (the
 * failed state offers the releases page itself); no HTML-URL fallback exists
 * because github.com does not send CORS headers, so the webview cannot read it.
 */
export async function fetchLatestTag(
  repo = "Stamir36/lumen-gallery",
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}
