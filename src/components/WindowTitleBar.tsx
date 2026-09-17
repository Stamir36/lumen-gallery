import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, Maximize2, X, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

const btnBase =
  "flex h-10 w-10 shrink-0 items-center justify-center text-tsecondary " +
  "transition-all duration-[160ms] ease-out active:scale-[.97]";

/** Chunky window controls for a frameless Tauri window (DESIGN.md v2.2 §6.7). */
export function WindowTitleBar({
  title = "LUMEN",
  leftAction,
  right,
}: {
  title?: string;
  leftAction?: ReactNode;
  /** slot rendered before the window controls (e.g. the view-mode switcher) */
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  const update = () =>
    getCurrentWindow()
      .isMaximized()
      .then(setMaximized)
      .catch(() => setMaximized(false));

  useEffect(() => {
    const unlisten = listen("tauri://resize", update);
    update();
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const minimize = () => getCurrentWindow().minimize();
  const toggleMaximize = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  /** Start a native window drag on mousedown (reliable in Tauri v2). */
  const startDrag = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return; // left button only
    void getCurrentWindow().startDragging();
  };

  /** Swallow mousedown so controls never begin a window drag. */
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-hairline bg-surface-1">
      {/* left cluster: icon + wordmark (mousedown swallowed → never drags) */}
      <div className="flex h-full items-center gap-3 px-4" onMouseDown={stop}>
        {leftAction ?? <Menu size={18} className="text-tsecondary" />}
        <span className="font-sans text-sm font-semibold tracking-tight text-tprimary">
          {title}
        </span>
      </div>

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
