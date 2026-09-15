import { useEffect, useState, type ReactNode } from "react";
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
}: {
  title?: string;
  leftAction?: ReactNode;
}) {
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

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-hairline bg-surface-1">
      {/* left cluster: icon + wordmark */}
      <div className="flex h-full items-center gap-3 px-4">
        {leftAction ?? <Menu size={18} className="text-tsecondary" />}
        <span className="font-sans text-sm font-semibold tracking-tight text-tprimary">
          {title}
        </span>
      </div>

      {/* drag spacer — double-click toggles maximize */}
      <div
        data-tauri-drag-region="true"
        className="flex-1 cursor-default"
        onDoubleClick={toggleMaximize}
      />

      {/* right cluster: window controls */}
      <div className="flex h-full items-center gap-0.5 pr-2">
        <button
          aria-label="Minimize"
          title="Minimize"
          className={cn(btnBase, "rounded-control hover:bg-surface-2")}
          onClick={minimize}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          className={cn(btnBase, "rounded-control hover:bg-surface-2")}
          onClick={toggleMaximize}
        >
          {maximized ? <Square size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          aria-label="Close"
          title="Close (Alt+F4)"
          className={cn(
            btnBase,
            "rounded-control text-danger hover:bg-danger/[.14] hover:text-danger",
          )}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
}
