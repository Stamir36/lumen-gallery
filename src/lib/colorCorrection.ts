import { useAppSettings } from "./settings";

/**
 * P7 F4 — GLOBAL video color correction.
 *
 * One CSS custom property on :root (--video-filter) carries the whole chain:
 * every video surface (main player, ambient layer, collage tiles) consumes it
 * via `filter: var(--video-filter, none)`, so a slider change restyles every
 * player at once with zero re-renders.
 *
 * The VR dome is explicitly OUT of scope: its fragment shader samples the
 * video texture directly inside the WebGL pipeline, and CSS filters do not
 * pass through WebGL framebuffers — mixing both would silently desync the
 * dome from the flat player.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** inject the shared unsharp filter defs (id="lumen-sharp") exactly once */
function ensureSharpFilter(): void {
  if (document.getElementById("lumen-sharp-defs")) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "lumen-sharp-defs";
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.id = "lumen-sharp";
  // full region: sharpening near edges must not be clipped
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  const conv = document.createElementNS(SVG_NS, "feConvolveMatrix");
  conv.setAttribute("order", "3");
  conv.setAttribute("preserveAlpha", "true");
  // identity kernel until the first apply
  conv.setAttribute("kernelMatrix", "0 0 0 0 1 0 0 0 0");
  filter.appendChild(conv);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

/** strength 0..1 → 3x3 unsharp kernel blended from identity */
function updateSharpKernel(strength: number): void {
  const conv = document
    .getElementById("lumen-sharp")
    ?.querySelector("feConvolveMatrix");
  if (!conv) return;
  const k = Math.max(0, Math.min(1, strength));
  const center = 1 + 4 * k;
  conv.setAttribute(
    "kernelMatrix",
    `0 ${-k} 0 ${-k} ${center} ${-k} 0 ${-k} 0`,
  );
}

/** recompute --video-filter on :root from the two settings values */
export function applyVideoFilter(saturation: number, sharpness: number): void {
  const parts: string[] = [`saturate(${saturation.toFixed(3)})`];
  if (sharpness > 0.001) {
    ensureSharpFilter();
    updateSharpKernel(sharpness);
    parts.push("url(#lumen-sharp)");
  }
  document.documentElement.style.setProperty("--video-filter", parts.join(" "));
}

/** keep :root in sync with the zustand store (called on load + every change) */
export function syncVideoFilterFromStore(): void {
  const { videoSaturation, videoSharpness } = useAppSettings.getState();
  applyVideoFilter(videoSaturation, videoSharpness);
}
