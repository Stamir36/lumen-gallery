import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

/**
 * Settings primitives (UI audit).
 *
 * The settings page had grown ten hand-copied switch blocks with slightly
 * different paddings and three near-identical pill groups. These pieces are
 * the shared vocabulary: one row rhythm, one switch, one segmented pill group.
 * Every row keeps its ARIA contract (`role="switch"` + accessible name).
 *
 * SEARCH lives in the LEFT nav column now (a quiet field under the section
 * list) — the old sticky search bar fought the page background and stuck
 * badly (user note: "поиску не место" — it belonged in the menu, not on the
 * page). Rows ask `useRowMatches` whether to render; empty sections hide
 * themselves in SettingsContent via a DOM walk over marked rows.
 */

const FilterContext = createContext<string>("");

/** Provides the active search query to every row on the page. */
export function SettingsFilterProvider({
  query,
  children,
}: {
  query: string;
  children: React.ReactNode;
}) {
  return <FilterContext.Provider value={query}>{children}</FilterContext.Provider>;
}

/**
 * True when the row should be visible for the active query. Every word in the
 * query must appear in the row's label/hint/keywords — AND, not OR, is what
 * people expect when they type a second word to narrow the list.
 */
export function useRowMatches(...parts: (string | undefined | false)[]) {
  const query = useContext(FilterContext);
  if (!query.trim()) return true;
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** A labelled row: label + optional hint on the left, control on the right. */
export function SettingRow({
  label,
  hint,
  children,
  className,
  keywords,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
  /** extra search terms that are not literally on screen (e.g. "tray", "safe") */
  keywords?: string;
}) {
  const visible = useRowMatches(label, hint, keywords);
  if (!visible) return null;
  return (
    <div
      // the marker is what the page-level filter counts: a section showing no
      // marked row hides itself, so an empty title never sits above nothing
      data-settings-row=""
      className={cn(
        // hairline between rows only — tone, not boxes (DESIGN v2.4)
        "flex min-h-[64px] items-center justify-between gap-6 border-t border-hairline py-4",
        "first:border-t-0 first:pt-0 last:pb-0",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-tprimary">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ttertiary">{hint}</span>}
      </span>
      {children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
    </div>
  );
}

/** The one switch in the app: h-6×w-11 pill, accent when on. */
export function Toggle({
  on,
  onChange,
  label,
  hint,
  className,
  keywords,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
  className?: string;
  keywords?: string;
}) {
  const visible = useRowMatches(label, hint, keywords);
  if (!visible) return null;
  return (
    <div
      data-settings-row=""
      className={cn(
        "flex min-h-[64px] items-center justify-between gap-6 border-t border-hairline py-4",
        "first:border-t-0 first:pt-0 last:pb-0",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-tprimary">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ttertiary">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[160ms] ease-out",
          on ? "bg-accent" : "bg-surface-3 hover:bg-surface-3/80",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow-[0_1px_3px_rgba(0,0,0,.4)]",
            "transition-all duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** Tonal pill group for small enumerated choices (density, workers, corners). */
export function PillChoice<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex shrink-0 items-center gap-0.5 rounded-pill bg-surface-3 p-1", className)}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center rounded-pill px-3 font-mono text-[12px]",
            "transition-colors duration-[160ms] ease-out",
            value === o.value
              ? "bg-white/[.14] text-tprimary"
              : "text-tsecondary hover:text-tprimary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
