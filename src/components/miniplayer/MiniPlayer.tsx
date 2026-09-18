import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Pause, Play, PictureInPicture2, X } from "lucide-react";
import type { MediaRow } from "@/lib/api";
import { mediaUrl } from "@/lib/api";
import { tauriAvailable } from "@/lib/assets";
import { cn } from "@/lib/utils";

/**
 * F5 — the custom mini-player (replaces the OS-painted browser PiP).
 *
 * Lives in its own frameless always-on-top Tauri window ("#/miniplayer").
 * The main window hands over `{ row, positionMs }` through `open_mini_player`;
 * the payload is injected as `window.__LUMEN_MINI__` (eval + a cheap poll:
 * a freshly created webview has no reliable "ready" handshake). Returning —
 * via the button, Esc, X or a window-close request — reports the position
 * through `mini_return`; `mini_note_position` keeps a recent fallback in Rust
 * so even Alt+F4 resumes correctly.
 */

interface MiniPayload {
  row: MediaRow;
  positionMs: number;
}

/** mono timecode ("1:04 / 3:20") */
function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${h > 0 ? `${h}:` : ""}${h > 0 ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}

export default function MiniPlayer() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [payload, setPayload] = useState<MiniPayload | null>(null);
  const [src, setSrc] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);

  // poll for the injected payload (also catches a second hand-off into an
  // already-open mini window, where eval mutates the var after mount)
  useEffect(() => {
    if (!tauriAvailable()) return;
    let last: MiniPayload | undefined;
    const id = window.setInterval(() => {
      const next = (window as unknown as Record<string, unknown>).__LUMEN_MINI__ as
        | MiniPayload
        | undefined;
      if (next && next !== last) {
        last = next;
        setPayload(next);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  // resolve the CORS-clean media url for the handed-over row
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setSrc("");
    mediaUrl(payload.row.path)
      .then((u) => {
        if (!cancelled) setSrc(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const row = payload?.row ?? null;

  // keep a recent position in Rust so ANY window close resumes correctly
  const notePosition = () => {
    const el = videoRef.current;
    if (!el || !row) return;
    void invoke("mini_note_position", {
      mediaId: row.id,
      positionMs: Math.round(el.currentTime * 1000),
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (!payload) return;
    const id = window.setInterval(notePosition, 5_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  // Esc / the return button: report position, then close
  const handBack = () => {
    const el = videoRef.current;
    if (!row) return;
    const positionMs = el ? Math.round(el.currentTime * 1000) : (payload?.positionMs ?? 0);
    notePosition();
    void invoke("mini_return", { mediaId: row.id, positionMs, close: true }).catch(() => {
      void getCurrentWindow().close();
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
      notePosition();
    }
  };

  const name = row ? (row.path.split(/[\\/]/).pop() ?? "") : "";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-tprimary select-none">
      {/* draggable title strip (frameless window) */}
      <div
        data-tauri-drag-region
        className="flex h-9 shrink-0 items-center gap-2 pl-3 pr-1"
      >
        <PictureInPicture2 size={13} className="text-tsecondary" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-tsecondary">{name}</span>
        <button
          type="button"
          aria-label={t("mini.close")}
          onClick={handBack}
          className="flex h-7 w-7 items-center justify-center rounded-[8px] text-tsecondary transition-colors hover:bg-white/[.08] hover:text-tprimary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          src={src || undefined}
          crossOrigin="anonymous"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setTotal(e.currentTarget.duration || 0);
            // start where the main player handed over
            if (payload && payload.positionMs > 0) {
              e.currentTarget.currentTime = payload.positionMs / 1000;
            }
            void e.currentTarget.play().catch(() => setPlaying(false));
          }}
          className="h-full w-full object-contain"
        />
        {!src && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-ttertiary">
            …
          </div>
        )}

        {/* bottom control pill */}
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-pill bg-black/55 px-2 py-1.5 backdrop-blur-md">
          <button
            type="button"
            aria-label={playing ? t("player.pause") : t("player.play")}
            onClick={togglePlay}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-[.94]",
            )}
          >
            {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <span className="min-w-[92px] text-center font-mono text-[11px] text-white/85">
            {mmss(time)} / {mmss(total)}
          </span>
          <button
            type="button"
            onClick={handBack}
            className="flex h-8 items-center rounded-pill px-3 text-[12px] text-white/85 transition-colors hover:bg-white/[.10] hover:text-white"
          >
            {t("mini.return")}
          </button>
        </div>
      </div>
    </div>
  );
}
