import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type MenuItem, runItem, useContextMenu } from "@/state/contextMenu";

const EDGE = 8;
const MIN_WIDTH = 236;
/** typeahead: letters typed within this window build ONE search buffer */
const TYPE_RESET_MS = 600;

/**
 * Right-click menu host (FIX 8) — one per app, rendered in a portal.
 *
 * Visual language: a glass panel (whitelisted floating surface), 13px labels,
 * 15px icons, mono hints on the right, hairline separators, mono section labels,
 * one red danger item at the end. It flips away from the viewport edges instead
 * of overflowing them, and closes on Escape, outside click, scroll or resize —
 * a menu that stays open after the grid scrolled is a menu that lies.
 *
 * B4 part 2 — KEYBOARD OPERATION (audit backlog, last piece):
 *  - roving tabindex: exactly one row is tabbable, the active one; ArrowUp/Down
 *    wrap, Home/End jump, Enter/Space activates, Esc closes;
 *  - typeahead: typing prefixes jumps to the next matching label (600ms buffer);
 *  - the menu takes focus when it opens and gives it BACK to the element that
 *    invoked it when it closes (guarded by isConnected — the card may be gone
 *    if the menu trashed it);
 *  - aria-activedescendant stays in sync with the active row; Tab leaves the
 *    menu (no focus trap: a context menu must not hold the app hostage).
 */
export function ContextMenuHost() {
  const { open, x, y, title, mono, sections, close } = useContextMenu();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const reduced = useReducedMotion();

  /** every row in visual order — the keyboard walks THIS, not the DOM */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  /** indexes of the rows the keyboard may land on */
  const reachable = useMemo(
    () => flat.flatMap((item, i) => (item.disabled ? [] : [i])),
    [flat],
  );
  const [active, setActive] = useState(-1);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const typed = useRef({ buf: "", at: 0 });

  const move = useCallback((index: number) => {
    setActive(index);
    rowRefs.current[index]?.focus({ preventScroll: true });
  }, []);

  // measure, clamp inside the window (flip, don't crop), then hand the keyboard
  // to the first row — arrows must work without a preliminary Tab
  useLayoutEffect(() => {
    if (!open) return;
    if (!opener.current && !panel.current?.contains(document.activeElement)) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setPos({ left: x, top: y });
    const el = panel.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const left = Math.min(x, window.innerWidth - rect.width - EDGE);
      const top = Math.min(y, window.innerHeight - rect.height - EDGE);
      setPos({ left: Math.max(EDGE, left), top: Math.max(EDGE, top) });
    }
    const first = reachable[0] ?? -1;
    setActive(first);
    if (first >= 0) rowRefs.current[first]?.focus({ preventScroll: true });
    return () => {
      const el2 = opener.current;
      // focus goes back to the invoking card — if it still exists
      if (el2?.isConnected) el2.focus({ preventScroll: true });
      opener.current = null;
    };
  }, [open, x, y, sections, reachable]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      close();
    };
    const walk = (delta: number) => {
      if (reachable.length === 0) return;
      const cur = reachable.indexOf(active);
      if (cur < 0) {
        move(delta > 0 ? reachable[0] : reachable[reachable.length - 1]);
        return;
      }
      const n = reachable.length;
      move(reachable[(((cur + delta) % n) + n) % n]);
    };
    const fire = () => {
      const i = active >= 0 ? active : reachable[0];
      const item = i === undefined ? undefined : flat[i];
      if (item) runItem(item);
    };
    const typeahead = (key: string) => {
      const now = Date.now();
      if (now - typed.current.at > TYPE_RESET_MS) typed.current.buf = "";
      typed.current.at = now;
      typed.current.buf += key.toLowerCase();
      const n = reachable.length;
      if (n === 0) return;
      const start = reachable.indexOf(active);
      for (let k = 1; k <= n; k += 1) {
        const i = reachable[(((start + k) % n) + n) % n];
        if (flat[i]?.label.toLowerCase().startsWith(typed.current.buf)) {
          move(i);
          return;
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab") {
        // a context menu does not trap Tab: leave and let the app have focus
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        walk(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        walk(-1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        if (reachable.length > 0) move(reachable[0]);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (reachable.length > 0) move(reachable[reachable.length - 1]);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fire();
        return;
      }
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.trim().length > 0
      ) {
        e.preventDefault();
        typeahead(e.key);
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
  }, [open, close, active, flat, reachable, move]);

  if (!open) return null;

  const activeItem = active >= 0 ? flat[active] : undefined;

  return createPortal(
    <motion.div
      ref={panel}
      role="menu"
      aria-label={title ?? "menu"}
      aria-activedescendant={activeItem ? `ctx-menu-${activeItem.id}` : undefined}
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
          {section.items.map((item) => {
            const index = flat.indexOf(item);
            return (
              <MenuRow
                key={item.id}
                item={item}
                index={index}
                activeIndex={active}
                register={(el) => {
                  rowRefs.current[index] = el;
                }}
                onHover={() => setActive(index)}
              />
            );
          })}
        </div>
      ))}
    </motion.div>,
    document.body,
  );
}

function MenuRow({
  item,
  index,
  activeIndex,
  register,
  onHover,
}: {
  item: MenuItem;
  index: number;
  activeIndex: number;
  register: (el: HTMLButtonElement | null) => void;
  onHover: () => void;
}) {
  const isActive = index === activeIndex;
  return (
    <button
      ref={register}
      type="button"
      role="menuitem"
      id={`ctx-menu-${item.id}`}
      disabled={item.disabled}
      // roving tabindex: one tabbable row — the active one
      tabIndex={isActive ? 0 : -1}
      onPointerEnter={onHover}
      onClick={() => runItem(item)}
      className={cn(
        "flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13px] transition-colors duration-[120ms]",
        item.disabled
          ? "cursor-default text-ttertiary opacity-45"
          : item.danger
            ? "text-tsecondary hover:bg-danger/12 hover:text-danger"
            : "text-tsecondary hover:bg-white/[.08] hover:text-tprimary",
        // the keyboard cursor must be unmistakable, and it is NOT hover
        isActive && !item.disabled && "bg-white/[.08] text-tprimary",
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
