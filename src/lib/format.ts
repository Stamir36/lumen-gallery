/**
 * Mono metadata formatting + date group keys.
 * Counters, durations and resolutions are metadata → JetBrains Mono at the
 * call site; these helpers only produce the strings.
 */

const DAY = 86_400_000;

/** "04:12" / "1:03:20" — video duration. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1920 × 1080" — image resolution chip. */
export function formatResolution(
  width: number | null,
  height: number | null,
): string | null {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

/** Stable per-day key in LOCAL time (date groups must match the visible date). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Date group label: "Today", "Yesterday", "12 March" or "12 March 2019".
 * Localized through Intl (ru/en handled by the platform).
 */
export function formatDayLabel(
  ms: number,
  lang: string,
  now = Date.now(),
): string {
  const today = startOfDay(now);
  if (ms >= today) return lang.startsWith("ru") ? "Сегодня" : "Today";
  if (ms >= today - DAY) return lang.startsWith("ru") ? "Вчера" : "Yesterday";
  const d = new Date(ms);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date(now).getFullYear()
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(lang, opts).format(d);
}

/** "IMG_2043.MP4" — filename from a full path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Compact relative time for the status line ticker. */
export function formatAgo(ms: number, lang: string, now = Date.now()): string {
  const diff = Math.max(0, Math.round((now - ms) / 1000));
  const ru = lang.startsWith("ru");
  if (diff < 5) return ru ? "только что" : "just now";
  if (diff < 60) return `${diff} ${ru ? "с" : "s"} ${ru ? "назад" : "ago"}`;
  const min = Math.round(diff / 60);
  if (min < 60) return `${min} ${ru ? "мин" : "min"} ${ru ? "назад" : "ago"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ${ru ? "ч" : "h"} ${ru ? "назад" : "ago"}`;
  const d = Math.round(h / 24);
  return `${d} ${ru ? "д" : "d"} ${ru ? "назад" : "ago"}`;
}
