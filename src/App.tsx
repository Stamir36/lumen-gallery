import { WindowTitleBar } from "@/components/WindowTitleBar";

/**
 * App shell. Phase 1–2 home placeholder — the design system lives at /style.
 * The frameless TitleBar chrome is shown on every real-window route.
 */
export default function App() {
  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar leftAction={<span className="text-xs font-mono text-ttertiary">v0.1</span>} />
      <main className="flex-1 overflow-auto p-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="text-3xl font-bold tracking-tight text-tprimary">LUMEN</h1>
          <p className="text-[15px] text-tsecondary">
            Local-first photo &amp; video gallery.
          </p>
          <div className="space-y-3">
            <button
              className="w-fit rounded-pill bg-accent px-6 py-2.5 text-sm font-medium text-[#0A0A0C] shadow-elev1 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.25)] active:scale-[.97]"
              onClick={() =>
                window
                  .open("http://localhost:1420/#/style")
                  ?.focus?.()
              }
            >
              Open design system (/style)
            </button>
          </div>
          <div className="mt-8 rounded-card border border-dashed border-hairline px-8 py-14 text-center">
            <span className="text-sm text-ttertiary">
              Library grid — Phase 2
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

