import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";

/**
 * Floating scroll-top button (FIX 6): 44px frosted-glass circle per the v2.1
 * whitelist recipe, arrow icon only. Appears with a spring after ~600px of
 * scrolling, hides at the top, smooth-scrolls back.
 */
export function ScrollTopFab({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVisible(el.scrollTop > 600);
      });
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetRef]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label={t("fab.scroll_top")}
          title={t("fab.scroll_top")}
          initial={reduced ? false : { opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          onClick={() =>
            targetRef.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
          }
          className="glass absolute bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-pill text-tprimary transition-transform duration-[160ms] active:scale-[.92]"
        >
          <ArrowUp size={18} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
