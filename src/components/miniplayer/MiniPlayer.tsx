import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Pause, PictureInPicture2, Play, RotateCcw, RotateCw, X } from "lucide-react";
import type { MediaRow } from "@/lib/api";
import { useMediaSource } from "@/lib/mediaSource";
import { tauriAvailable } from "@/lib/assets";
import { isDesktop } from "@/lib/platform";
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
 * BUGS 29.09: the window is now PURE video — no top strip, no caption. The
 * whole window drags: the video surface carries `data-tauri-drag-region` and
 * every control layer swallows mousedown, so grabbing any empty spot moves
 * the window while buttons keep working. Double-click still toggles playback
 * (a drag uses buttons 1 + movement, a double-click two clean presses).
 *
 * Timeline fix (same report): the scrubber never left the viewport — the bug
 * was pointer CAPTURE aimed at `e.target`, which is the thumb <span> under
 * the cursor; the thumb re-renders mid-drag, the capture dies, and the next
 * pointermove fired on the window with `scrubbing` still true while the
 * handler read a stale rect. Now capture is taken on the TRACK element (a
 * stable parent), the ratio is clamped to [0,1] EVERYWHERE, and a window
 * pointerup fallback releases the drag even when the element missed the event.
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

/** clamped ratio of clientX within a rect — the only place ratios are made */
function ratioIn(clientX: number, rect: DOMRect): number {
  return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
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

  // BUGS 29.09: a pointerup outside the scrubber (fast flick off the pill)
  // used to leave `scrubbing` true forever — the timeline then chased the
  // cursor until a click landed back on it. Window-level safety net.
  useEffect(() => {
    const release = () => {
      scrubbing.current = false;
      setSeekPreview(null);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, []);

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

  const seekRatio = (ratio: number) => {
    const el = videoRef.current;
    if (!el || !total) return;
    const at = Math.max(0, Math.min(1, ratio)) * total;
    el.currentTime = at;
    setTime(at);
  };

  const name = row ? (row.path.split(/[\\/]/).pop() ?? "") : "";
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  const shown = Math.max(0, Math.min(1, seekPreview ?? progress));

  /** swallow mousedown so controls never begin a window drag */
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={shellRef}
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-black text-tprimary"
      onPointerMove={poke}
      onPointerDown={poke}
    >
      {/* the video IS the window: pure frame, no strip, no caption. The drag
          region behind the video moves the window from any empty spot; the
          <video> itself stays transparent to drags so double-click toggles
          playback. Edge strips (top/bottom) drag too — they are outside the
          letterboxed content, so no gesture conflicts. */}
      <div data-tauri-drag-region={isDesktop ? "true" : undefined} className="absolute inset-0" />

      {/* top edge drag strip — grabs like a title bar, hides with chrome */}
      <div
        data-tauri-drag-region={isDesktop ? "true" : undefined}
        className={cn(
          "absolute inset-x-0 top-0 z-10 h-8 transition-opacity duration-[200ms]",
          chrome ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        className="relative z-10 min-h-0 flex-1"
        onDoubleClick={isDesktop ? togglePlay : undefined}
      >
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
            "absolute bottom-3 left-1/2 z-20 -translate-x-1/2 transition-all duration-[200ms] ease-out",
            chrome ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <div
            className="flex flex-col gap-1.5 rounded-[16px] px-3 pb-2.5 pt-2"
            onMouseDown={stop}
            style={{
              background: "linear-gradient(180deg, rgba(14,14,18,.68), rgba(14,14,18,.55))",
              backdropFilter: "blur(28px) saturate(1.4)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.10), 0 8px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08)",
            }}
          >
            {/* name + close: the strip's only survivors, inside the pill */}
            <div className="flex items-center gap-2 px-1">
              <PictureInPicture2 size={12} className="shrink-0 text-ttertiary" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-tsecondary">{name}</span>
              <button
                type="button"
                aria-label={t("mini.close")}
                title={t("mini.close")}
                onClick={handBack}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-tsecondary transition-all duration-[160ms] hover:bg-white/[.08] hover:text-tprimary"
              >
                <X size={13} />
              </button>
            </div>

            {/* Material You scrubber: 4px track, accent fill, white thumb.
                Capture lives on the TRACK (stable node), ratios are clamped
                centrally — the fly-off bug. */}
            <div
              role="slider"
              aria-label={t("player.seek")}
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(time)}
              tabIndex={0}
              onPointerDown={(e) => {
                scrubbing.current = true;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = ratioIn(e.clientX, rect);
                setTime(ratio * total);
                setSeekPreview(ratio * total);
              }}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = ratioIn(e.clientX, rect);
                if (!scrubbing.current) {
                  setSeekPreview(ratio * total);
                  return;
                }
                setTime(ratio * total);
              }}
              onPointerUp={(e) => {
                scrubbing.current = false;
                const rect = e.currentTarget.getBoundingClientRect();
                seekRatio(ratioIn(e.clientX, rect));
                setSeekPreview(null);
                poke();
              }}
              onPointerLeave={() => {
                if (!scrubbing.current) setSeekPreview(null);
              }}
              onLostPointerCapture={() => {
                scrubbing.current = false;
              }}
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
