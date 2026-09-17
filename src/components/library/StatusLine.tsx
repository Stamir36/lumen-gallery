import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatCount } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import type { LibrarySummary } from "@/lib/api";

/**
 * Mono status line (SPEC §6): `12,482 items · 348 GB · scanned 2s ago`.
 * Only this component re-renders on the 1s ticker, so the ticker can't drag
 * the grid down.
 */
export function StatusLine({
  summary,
  lastScanAt,
  scanning,
  scanText,
}: {
  summary?: LibrarySummary;
  lastScanAt: number | null;
  scanning: boolean;
  scanText: string;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const offline = summary?.offline ?? 0;

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-hairline bg-surface-1 px-9 font-mono text-[11px] tracking-[0.04em] text-ttertiary">
      {scanning ? (
        <span className="text-tsecondary">{scanText}</span>
      ) : (
        <span>
          {t("counts.items", { count: summary?.total ?? 0 })} · {formatBytes(summary?.bytes ?? 0)}
          {lastScanAt ? ` · ${t("status.scanned_ago", { ago: formatAgo(lastScanAt, i18n.language, now) })}` : ""}
        </span>
      )}
      {offline > 0 && (
        <span className="text-warning">· {t("status.offline", { count: offline })}</span>
      )}
      <span className="ml-auto">{formatCount(summary?.images ?? 0)} / {formatCount(summary?.videos ?? 0)}</span>
    </div>
  );
}
