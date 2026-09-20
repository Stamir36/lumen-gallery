import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPresetAccent } from "@/lib/accent";

/**
 * F12 — in-app accent picker (replaces the OS <input type="color"> dialog,
 * which was the one piece of chrome that screamed "web page").
 *
 * A dark-glass popover with a hue slider + saturation/brightness field
 * (pointer scrubbing, HSV model) and a hex field for exact input. Everything
 * writes through the same setAccent path, so the whole UI repaints live while
 * dragging.
 */

/** HSV <-> hex helpers (tiny, local — no colour lib for one component). */
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  const to = (x: number) => x.toString(16).padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0.58, s: 0.55, v: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Accepts "#AABBCC", "aabbcc", "#abc" → "#aabbcc"; anything else → null. */
function normalizeHex(input: string): string | null {
  const v = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) {
    return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toLowerCase();
  return null;
}

/** hex → commit() argument tuple (keeps the spread call site readable). */
function hsvOf(hex: string): [number, number, number] {
  const { h, s, v } = hexToHsv(hex);
  return [h, s, v];
}

/**
 * Saturation/brightness field: base = the pure hue, white bleeding in from the
 * left, black from the bottom — the standard picker square. Pointer scrub with
 * capture, so a drag that leaves the box keeps tracking (native-app feel).
 */
function SvField({
  hsv,
  onChange,
}: {
  hsv: { h: number; s: number; v: number };
  onChange: (s: number, v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const apply = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const v = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    onChange(s, v);
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="saturation / brightness"
      aria-valuenow={Math.round(hsv.s * 100)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        // only while captured (buttons held) — a hover must not repaint the UI
        if (e.buttons !== 1) return;
        apply(e.clientX, e.clientY);
      }}
      className="relative h-[132px] w-full cursor-crosshair overflow-hidden rounded-control"
      style={{ background: hsvToHex(hsv.h, 1, 1) }}
    >
      {/* white → hue (horizontal) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(90deg, #fff, rgba(255,255,255,0))" }}
      />
      {/* transparent → black (vertical) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(0deg, #000, rgba(0,0,0,0))" }}
      />
      {/* the cursor dot */}
      <span
        className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_1px_6px_rgba(0,0,0,.6)]"
        style={{
          left: `calc(${hsv.s * 100}% - 7px)`,
          top: `calc(${(1 - hsv.v) * 100}% - 7px)`,
        }}
      />
    </div>
  );
}

export function AccentPicker({
  accent,
  onPick,
}: {
  accent: string;
  onPick: (hex: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(accent);
  const popRef = useRef<HTMLDivElement>(null);

  // outside-click + Esc close (no extra dependency — same pattern as menus)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => setHexDraft(accent), [accent, open]);

  // Keep the HSV model in step whenever the accent changes from OUTSIDE (preset
  // click, another window, settings reload). Local drags write through commit()
  // first, so this only ever re-normalises — never fights the pointer.
  const [hsv, setHsv] = useState(() => hexToHsv(accent));
  useEffect(() => setHsv(hexToHsv(accent)), [accent]);

  const commit = (h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    onPick(hsvToHex(h, s, v));
  };

  const customActive = !isPresetAccent(accent);

  return (
    <div ref={popRef} className="relative">
      {/* trigger: the rainbow conic swatch — active colour fills it when custom */}
      <button
        type="button"
        title={t("settings.accent_custom")}
        aria-label={t("settings.accent_custom")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-pill transition-all duration-[160ms] ease-out hover:scale-105 active:scale-[.94]",
          customActive
            ? "ring-2 ring-white/85 ring-offset-2 ring-offset-surface-1"
            : "opacity-90 hover:opacity-100",
        )}
        style={{
          background: customActive
            ? accent
            : "conic-gradient(from 200deg, #8A7CFF, #F45BD8, #FF7A59, #AEE64B, #45E3E0, #6EC1FF, #8A7CFF)",
        }}
      >
        {customActive && <Check size={13} strokeWidth={3} className="text-[#0A0A0C]" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("settings.accent_custom")}
          /* glass popover, right-aligned to the swatch row — the same material
             as the menus (v2.3 dark recipe) */
          className="glass absolute right-0 top-11 z-50 w-[268px] rounded-[20px] p-3.5"
        >
          {/* saturation / brightness field: white → hue horizontally,
              transparent → black vertically. Scrub anywhere, live repaint. */}
          <SvField
            hsv={hsv}
            onChange={(s, v) => commit(hsv.h, s, v)}
          />

          {/* hue strip */}
          <input
            type="range"
            min={0}
            max={360}
            value={Math.round(hsv.h * 360)}
            onChange={(e) => commit(Number(e.target.value) / 360, hsv.s, hsv.v)}
            aria-label={t("settings.accent_hue")}
            className="mt-3 h-2.5 w-full cursor-pointer appearance-none rounded-pill"
            style={{
              background:
                "linear-gradient(90deg, #FF5C5C, #FFC46B, #AEE64B, #45E3E0, #6EC1FF, #8A7CFF, #F45BD8, #FF5C5C)",
            }}
          />

          <div className="mt-3 flex items-center gap-2">
            <span
              className="h-9 w-9 shrink-0 rounded-control border border-white/10"
              style={{ background: accent }}
              aria-hidden
            />
            <input
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = normalizeHex(hexDraft);
                  if (v) commit(...hsvOf(v));
                }
              }}
              onBlur={() => {
                const v = normalizeHex(hexDraft);
                if (v) commit(...hsvOf(v));
                else setHexDraft(accent);
              }}
              spellCheck={false}
              aria-label={t("settings.accent_hex")}
              className="h-9 min-w-0 flex-1 rounded-control bg-surface-2 px-3 font-mono text-[12px] uppercase tracking-[0.06em] text-tprimary outline-none transition-colors focus:bg-surface-3"
            />
          </div>
        </div>
      )}
    </div>
  );
}
