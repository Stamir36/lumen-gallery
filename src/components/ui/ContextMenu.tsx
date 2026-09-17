import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type MenuItem, runItem, useContextMenu } from "@/state/contextMenu";

const EDGE = 8;
const MIN_WIDTH = 236;

/**
 * Right-click menu host (FIX 8) — one per app, rendered in a portal.
 *
 * Visual language: a glass panel (whitelisted floating surface), 13px labels,
 * 15px icons, mono hints on the right, hairline separators, mono section labels,
 * one red danger item at the end. It flips away from the viewport edges instead
 * of overflowing them, and closes on Escape, outside click, scroll or resize —
 * a menu that stays open after the grid scrolled is a menu that lies.
 */
export function ContextMenuHost() {
  const { open, x, y, title, mono, sections, close } = useContextMenu();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const reduced = useReducedMotion();

  // measure, then clamp inside the window (flip, don't crop)
  useLayoutEffect(() => {
    if (!open) return;
    setPos({ left: x, top: y });
    const el = panel.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - EDGE);
    const top = Math.min(y, window.innerHeight - rect.height - EDGE);
    setPos({
      left: Math.max(EDGE, left),
      top: Math.max(EDGE, top),
    });
  }, [open, x, y, sections]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const onAway = () => close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onAway);
    window.addEventListener("scroll", onAway, true);
    window.addEventListener("blur", onAway);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("scroll", onAway, true);
      window.removeEventListener("blur", onAway);
    };
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <motion.div
      ref={panel}
      role="menu"
      aria-label={title ?? "menu"}
      initial={reduced ? false : { opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.12, ease: "easeOut" }}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        minWidth: MIN_WIDTH,
        transformOrigin: "top left",
      }}
      className="glass z-[200] overflow-hidden rounded-[16px] p-1.5"
    >
      {(title || mono) && (
        <div className="px-2.5 pb-1.5 pt-1">
          {title && (
            <div className="truncate text-[13px] font-medium text-tprimary">{title}</div>
          )}
          {mono && (
            <div className="truncate font-mono text-[10.5px] text-ttertiary">{mono}</div>
          )}
        </div>
      )}

      {sections.map((section, si) => (
        <div key={section.id}>
          {(si > 0 || title || mono) && <div className="my-1 h-px bg-white/8" />}
          {section.label && (
            <div className="px-2.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ttertiary">
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <MenuRow key={item.id} item={item} />
          ))}
        </div>
      ))}
    </motion.div>,
    document.body,
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => runItem(item)}
      className={cn(
        "flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13px] transition-colors duration-[120ms]",
        item.disabled
          ? "cursor-default text-ttertiary opacity-45"
          : item.danger
            ? "text-tsecondary hover:bg-danger/12 hover:text-danger"
            : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-80">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint && (
        <span className="shrink-0 font-mono text-[10.5px] text-ttertiary">{item.hint}</span>
      )}
    </button>
  );
}
