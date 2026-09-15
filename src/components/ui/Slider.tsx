import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Soft Slider v2 (DESIGN.md v2 §7, §10 — like the old settings screen):
 * 4px track surface-2, accent fill left, 18px white thumb with shadow,
 * optional mono value chip.
 */
export interface SliderProps {
  value: number; // 0..100
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  valueLabel?: string;
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
  className,
  "aria-label": ariaLabel,
}: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("flex w-full items-center gap-4", className)}>
      <div className="relative flex h-6 min-w-0 flex-1 items-center">
        <div className="h-1 w-full rounded-pill bg-surface-2" />
        <div
          className="absolute left-0 h-1 rounded-pill bg-accent"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute h-[18px] w-[18px] rounded-pill bg-white shadow-[0_2px_8px_rgba(0,0,0,.55)]"
          style={{ left: `calc(${pct}% - 9px)` }}
        />
        <input
          id={id}
          type="range"
          aria-label={ariaLabel}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      {valueLabel && (
        <span className="rounded-pill bg-surface-2 px-3 py-1 font-mono text-[12px] text-tsecondary">
          {valueLabel}
        </span>
      )}
    </div>
  );
}
