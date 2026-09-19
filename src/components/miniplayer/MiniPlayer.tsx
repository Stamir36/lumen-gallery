import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Pause, PictureInPicture2, Play, RotateCcw, RotateCw, X } from "lucide-react";
import type { MediaRow } from "@/lib/api";
import { useMediaSource } from "@/lib/mediaSource";
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
 *
 * Design (DESIGN.md v2): one floating glass pill (the whitelisted blur
 * surface), mono .timecode readouts, Material You scrubber with accent fill,
 * auto-hide after 2s idle — a miniature of the main player, not a raw <video>.
 */

interface MiniPayload {
  row: MediaRow;
  positionMs: number;
}

const HIDE_AFTER_MS = 2_000;

/** mono timecode ("1:04 / 3:20") */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export default function MiniPlayer() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hideAt = useRef(0);
  const scrubbing = useRef(false);
  const [payload, setPayload] = useState<MiniPayload | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

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

  // ONE source policy: asset protocol by default (instant), media server only
  // when opted in — same hook the main player and collage tiles use.
  const { src } = useMediaSource(payload?.row.path ?? null);

  const row = payload?.row ?? null;

  // controls auto-hide (2s idle, never while paused or scrubbing)
  const poke = useCallback(() => {
    setChrome(true);
    hideAt.current = Date.now() + HIDE_AFTER_MS;
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused || scrubbing.current) {
        setChrome(true);
        return;
      }
      setChrome(Date.now() < hideAt.current);
    }, 250);
    poke();
    return () => window.clearInterval(id);
  }, [poke]);

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
      poke();
      if (e.key === "Escape") {
        handBack();
        return;
      }
      const el = videoRef.current;
      if (!el) return;
      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        el.currentTime = Math.min(el.duration || 0, el.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        el.currentTime = Math.max(0, el.currentTime - 5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    poke();
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
      notePosition();
    }
  };

  const seekBy = (delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
    poke();
  };

  const scrubTo = (clientX: number, bar: HTMLElement) => {
    const el = videoRef.current;
    if (!el || !total) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * total;
    setTime(ratio * total);
    setSeekPreview(null);
    poke();
  };

  const name = row ? (row.path.split(/[\\/]/).pop() ?? "") : "";
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  const shown = seekPreview ?? progress;

  return (
    <div
      ref={shellRef}
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-black text-tprimary"
      onPointerMove={poke}
      onPointerDown={poke}
    >
      {/* draggable title strip (frameless window) — glass chip, name leads */}
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-2 px-3"
      >
        <PictureInPicture2 size={13} className="shrink-0 text-ttertiary" />
        <span
          data-tauri-drag-region
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] transition-opacity duration-[200ms]",
            chrome ? "text-tsecondary opacity-100" : "opacity-0",
          )}
        >
          {name}
        </span>
        <button
          type="button"
          aria-label={t("mini.close")}
          title={t("mini.close")}
          onClick={handBack}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-tsecondary transition-all duration-[160ms] hover:bg-white/[.08] hover:text-tprimary",
            !chrome && "opacity-0",
          )}
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1" onDoubleClick={togglePlay}>
        <video
          ref={videoRef}
          src={src || undefined}
          playsInline
          onPlay={() => {
            setPlaying(true);
            poke();
          }}
          onPause={() => {
            setPlaying(false);
            setChrome(true);
            notePosition();
          }}
          onTimeUpdate={(e) => {
            if (!scrubbing.current) setTime(e.currentTarget.currentTime);
          }}
          onLoadedMetadata={(e) => {
            setTotal(e.currentTarget.duration || 0);
            // start where the main player handed over
            if (payload && payload.positionMs > 0) {
              e.currentTarget.currentTime = payload.positionMs / 1000;
            }
            void e.currentTarget.play().catch(() => setPlaying(false));
          }}
          className="h-full w-full object-contain"
          style={{ filter: "var(--video-filter, none)" }}
        />
        {!src && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ttertiary">
              {t("mini.loading")}
            </span>
          </div>
        )}

        {/* ---------- one floating glass control pill (whitelisted blur) ---------- */}
        <div
          className={cn(
            "absolute bottom-4 left-1/2 -translate-x-1/2 transition-all duration-[200ms] ease-out",
            chrome ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <div className="flex flex-col gap-1.5 rounded-[16px] px-3 pb-2.5 pt-2"
            style={{
              background: "linear-gradient(180deg, rgba(14,14,18,.68), rgba(14,14,18,.55))",
              backdropFilter: "blur(28px) saturate(1.4)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.10), 0 8px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08)",
            }}
          >
            {/* Material You scrubber: 4px track, accent fill, white thumb */}
            <div
              role="slider"
              aria-label={t("player.seek")}
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(time)}
              tabIndex={0}
              onPointerDown={(e) => {
                scrubbing.current = true;
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                scrubTo(e.clientX, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (!scrubbing.current) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setSeekPreview(
                    Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total,
                  );
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                setTime(ratio * total);
              }}
              onPointerUp={(e) => {
                scrubbing.current = false;
                scrubTo(e.clientX, e.currentTarget);
              }}
              onPointerLeave={() => setSeekPreview(null)}
              className="group relative mx-1 mt-1 h-6 cursor-pointer"
            >
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-white/15">
                <div
                  className="absolute inset-y-0 left-0 rounded-pill bg-accent"
                  style={{ width: `${shown * 100}%` }}
                />
              </div>
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,.55)] transition-transform duration-[140ms] group-hover:scale-110"
                style={{ left: `${shown * 100}%` }}
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t("player.back10")}
                title={t("player.back10")}
                onClick={() => seekBy(-10)}
                className="flex h-8 w-8 items-center justify-center rounded-pill text-tsecondary transition-colors hover:bg-white/[.08] hover:text-tprimary"
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                aria-label={playing ? t("mini.pause") : t("mini.play")}
                title={playing ? t("mini.pause") : t("mini.play")}
                onClick={togglePlay}
                className="mx-1 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform duration-[160ms] active:scale-[.94]"
              >
                {playing ? (
                  <Pause size={16} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play size={16} fill="currentColor" strokeWidth={0} className="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                aria-label={t("player.fwd10")}
                title={t("player.fwd10")}
                onClick={() => seekBy(10)}
                className="flex h-8 w-8 items-center justify-center rounded-pill text-tsecondary transition-colors hover:bg-white/[.08] hover:text-tprimary"
              >
                <RotateCw size={15} />
              </button>

              <span className="mx-1 h-5 w-px bg-white/10" />

              {/* .timecode (JetBrains Mono tabular) — the player clock contract */}
              <span className="timecode min-w-[96px] text-center text-[11px] tabular-nums text-white/85">
                {clock(time)} / {clock(total)}
              </span>

              <span className="mx-1 h-5 w-px bg-white/10" />

              <button
                type="button"
                onClick={handBack}
                className="flex h-8 items-center rounded-pill px-3 text-[12px] text-tsecondary transition-colors hover:bg-white/[.10] hover:text-tprimary"
              >
                {t("mini.return")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
