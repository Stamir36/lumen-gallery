import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Soft Slider v2.5 (DESIGN.md §7, §10 — like the old settings screen):
 * 4px track, accent fill left, 18px white thumb with shadow, optional mono
 * value chip.
 *
 * v2.5 additions:
 *  - `variant="glass"` — for a control that sits ON blurred video (the player's
 *    colour sheet): the track becomes white/14 instead of opaque surface-2, so
 *    it reads as part of the glass pill rather than a dark groove in it, and the
 *    fill carries a soft accent glow.
 *  - `mark` — a neutral detent hairline (saturation: the 100% position). Sliders
 *    that have a "default" deserve to show it.
 *  - focus ring: the native range stays invisible but is now the FIRST child
 *    (`peer`), so the drawn thumb can show the 2px accent ring on :focus-visible.
 */
export interface SliderProps {
  value: number; // 0..100
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  valueLabel?: string;
  /** "glass" for surfaces over video, "solid" (default) everywhere else */
  variant?: "solid" | "glass";
  /** neutral detent, as a percentage of the track (0..100) */
  mark?: number;
  className?: string;
  "aria-label"?: string;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  valueLabel,
  variant = "solid",
  mark,
  className,
  "aria-label": ariaLabel,
}: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const glass = variant === "glass";
  return (
    <div className={cn("flex w-full items-center gap-4", className)}>
      <div className="relative flex h-6 min-w-0 flex-1 items-center">
        {/* the real control: invisible, but first so the drawn parts can react
            to its focus state (peer) and it keeps full keyboard semantics */}
        <input
          id={id}
          type="range"
          aria-label={ariaLabel}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
        />
        <div
          className={cn(
            "pointer-events-none h-1 w-full rounded-pill",
            glass ? "bg-white/[.14]" : "bg-surface-2",
          )}
        />
        {mark !== undefined && (
          <div
            className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 rounded-pill bg-white/25"
            style={{ left: `${mark}%` }}
          />
        )}
        <div
          className={cn(
            "pointer-events-none absolute left-0 h-1 rounded-pill bg-accent",
            glass && "shadow-[0_0_14px_rgba(110,193,255,.5)]",
          )}
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute h-[18px] w-[18px] rounded-pill bg-white shadow-[0_2px_8px_rgba(0,0,0,.55)] transition-[box-shadow,transform] duration-[140ms] peer-active:scale-[1.12] peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent"
          style={{ left: `calc(${pct}% - 9px)` }}
        />
      </div>
      {valueLabel && (
        <span
          className={cn(
            "rounded-pill px-3 py-1 font-mono text-[12px] text-tsecondary",
            glass ? "bg-white/[.08]" : "bg-surface-2",
          )}
        >
          {valueLabel}
        </span>
      )}
    </div>
  );
}
