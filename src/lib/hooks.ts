import { useEffect, useState, type RefObject } from "react";

/**
 * Observable element width — justified rows are width-dependent, so the grid
 * recomputes its row packing whenever the window/panel resizes.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 1200) {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(1, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

/** rAF-throttled scroll subscription (masonry virtual window). */
export function useRafScroll(
  ref: RefObject<HTMLElement | null>,
  onScroll: (top: number, height: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const handle = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onScroll(el.scrollTop, el.clientHeight);
      });
    };
    handle();
    el.addEventListener("scroll", handle, { passive: true });
    const ro = new ResizeObserver(handle);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", handle);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, onScroll]);
}
