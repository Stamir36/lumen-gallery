import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { tauriAvailable } from "@/lib/assets";
import { APP_VERSION } from "@/lib/version";
import appIcon from "@/../assets/icon.svg";

/**
 * Window controls, browser-safe.
 *
 * Every one of these calls goes through the Tauri IPC bridge, which does not
 * exist in a plain browser. `getCurrentWindow()` THROWS synchronously there
 * (`__TAURI_INTERNALS__.metadata` of undefined), and because it ran inside an
 * effect the throw unmounted the whole route — the QA surfaces (#/settings,
 * #/onboarding) rendered a blank page. The guard keeps those routes usable as
 * the screenshot harness the e2e suite relies on.
 */
function win() {
  return tauriAvailable() ? getCurrentWindow() : null;
}

const btnBase =
  "flex h-10 w-10 shrink-0 items-center justify-center text-tsecondary " +
  "transition-all duration-[160ms] ease-out active:scale-[.97]";

/** Chunky window controls for a frameless Tauri window (DESIGN.md v2.2 §6.7). */
export function WindowTitleBar({
  title = "LUMEN",
  leftAction,
  right,
  /** F4: rail mode hosts the library controls HERE, so the screen carries
   *  exactly one header; classic mode leaves it undefined */
  center,
}: {
  title?: string;
  leftAction?: ReactNode;
  /** slot rendered before the window controls (e.g. the view-mode switcher) */
  right?: ReactNode;
  /** slot between the wordmark and the drag spacer (library controls, rail) */
  center?: ReactNode;
}) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  const update = () =>
    win()
      ?.isMaximized()
      .then(setMaximized)
      .catch(() => setMaximized(false));

  useEffect(() => {
    if (!tauriAvailable()) return;
    const unlisten = listen("tauri://resize", update);
    update();
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const minimize = () => win()?.minimize();
  const toggleMaximize = () => win()?.toggleMaximize();
  const close = () => win()?.close();

  /** Start a native window drag on mousedown (reliable in Tauri v2). */
  const startDrag = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return; // left button only
    void win()?.startDragging();
  };

  /** Swallow mousedown so controls never begin a window drag. */
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-hairline bg-surface-1">
      {/* left cluster: app mark + wordmark + tiny version pill (BUGS 29.09:
          the hard-coded v0.1 disagreed with the About screen; the version now
          reads from APP_VERSION and lives in a quiet pill by the name).
          Mousedown swallowed → never drags. */}
      <div className="flex h-full items-center gap-3 px-4" onMouseDown={stop}>
        {leftAction ?? (
          <img
            src={appIcon}
            alt=""
            aria-hidden
            width={20}
            height={20}
            draggable={false}
            className="h-5 w-5 rounded-[6px]"
          />
        )}
        <span className="font-sans text-sm font-semibold tracking-tight text-tprimary">
          {title}
        </span>
        <span
          aria-hidden
          className="rounded-pill bg-white/[.05] px-1.5 py-px font-mono text-[10px] leading-4 tabular-nums text-ttertiary"
        >
          v{APP_VERSION}
        </span>
      </div>

      {/* F4: in rail mode the library search + sort/view/selection live in the
          titlebar — one header for the whole screen. Swallowed mousedown so
          the controls never start a window drag. */}
      {center && (
        <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-4" onMouseDown={stop}>
          {center}
        </div>
      )}

      {/* drag spacer — empty area only; drags the window via startDragging() */}
      <div
        data-tauri-drag-region="true"
        className="h-full flex-1 cursor-default"
        onMouseDown={startDrag}
        onDoubleClick={toggleMaximize}
      />

      {/* app-level actions: kept out of the drag region */}
      {right && (
        <div className="flex h-full shrink-0 items-center gap-2 pr-2" onMouseDown={stop}>
          {right}
        </div>
      )}

      {/* right cluster: window controls */}
      <div className="flex h-full items-center gap-0.5 pr-2">
        <button
          aria-label={t("titlebar.minimize")}
          title={t("titlebar.minimize")}
          className={cn(btnBase, "rounded-control hover:bg-surface-2")}
          onMouseDown={stop}
          onClick={minimize}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          className={cn(btnBase, "rounded-control hover:bg-surface-2")}
          onMouseDown={stop}
          onClick={toggleMaximize}
        >
          {maximized ? <Square size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          aria-label={t("titlebar.close")}
          title={t("titlebar.close")}
          className={cn(
            btnBase,
            "rounded-control text-danger hover:bg-danger/[.14] hover:text-danger",
          )}
          onMouseDown={stop}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
}
