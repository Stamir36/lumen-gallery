import { GRID_GAP, TARGET_ROW_H, computeJustifiedRows, computeSquareRows } from "@/lib/justified";
import type { ViewMode } from "@/state/library-ui";

/**
 * Skeletons in the FINAL grid shape (DESIGN.md §10 "Skeletons: surface-2
 * shimmer kept") — a placeholder that matches the incoming rows instead of a
 * generic spinner. Ratios alternate so the silhouette reads as a real collage.
 */
const CYCLE = [1.5, 1.78, 0.75, 1.33, 1.5, 1.0, 1.78, 1.33, 0.6, 1.5, 1.33, 1.78];

const RADIUS = 12;

export function SkeletonGrid({ width, view }: { width: number; view: ViewMode }) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-2 px-9 pb-24">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex h-16 items-center gap-4">
            <div className="shimmer-bg h-11 w-11 shrink-0" style={{ borderRadius: 10 }} />
            <div className="shimmer-bg h-4 flex-1 max-w-[420px]" style={{ borderRadius: 6 }} />
            <div className="shimmer-bg h-3 w-24" style={{ borderRadius: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (view === "square") {
    const rows = computeSquareRows(24, width, TARGET_ROW_H, GRID_GAP);
    return (
      <div className="px-9 pb-24">
        {rows.map((row, i) => (
          <div key={i} className="flex" style={{ gap: GRID_GAP, marginBottom: GRID_GAP }}>
            {row.indices.map((c) => (
              <div
                key={c}
                className="shimmer-bg"
                style={{ width: row.widths[c], height: row.height, borderRadius: RADIUS }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const ratios = Array.from({ length: 36 }, (_, i) => CYCLE[i % CYCLE.length]);
  const rows = computeJustifiedRows(ratios, width, TARGET_ROW_H, GRID_GAP);
  return (
    <div className="px-9 pb-24">
      <div className="shimmer-bg mb-3 h-4 w-32" style={{ borderRadius: 6 }} />
      {rows.map((row, i) => (
        <div key={i} className="flex" style={{ gap: GRID_GAP, marginBottom: GRID_GAP }}>
          {row.widths.map((w, c) => (
            <div
              key={c}
              className="shimmer-bg"
              style={{ width: w, height: row.height, borderRadius: RADIUS }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
