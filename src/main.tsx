import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import StylePage from "./pages/StylePage";
import OnboardingPage from "./pages/OnboardingRoute";
import SettingsPage from "./pages/SettingsPage";
import AssetTest from "./pages/AssetTest";
import GridDemo from "./pages/GridDemo";
import MiniPlayer from "./components/miniplayer/MiniPlayer";
import { invoke } from "@tauri-apps/api/core";
import { initI18n, readSavedLang, applyCursorPreference } from "./i18n";
import { tauriAvailable } from "./lib/assets";
import { applyCachedAccent } from "./lib/accent";
import { initScanListener, initOfflineListener } from "./state/library";
import { queryClient } from "./lib/queryClient";
import { startPerfWatchdog } from "./lib/perf";
import { initExternalOpen } from "./lib/externalOpen";
import "./index.css";

// frame-rate + long-task watchdog: an "it froze" report should come with numbers
startPerfWatchdog();

// P7 F1: kill the browser context menu app-wide — the app ships its own
// right-click menus (cards, folders, tree rows, viewer). Native editing menu
// stays on text inputs so copy/paste keeps working in search and settings.
// Capture phase = nothing downstream can re-open it.
document.addEventListener(
  "contextmenu",
  (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (
      el?.closest(
        "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
      )
    )
      return;
    e.preventDefault();
  },
  true,
);

// accent BEFORE the first paint (SQLite is the source of truth, the cached hex
// only prevents a default-colour flash on launch — FIX 4a)
applyCachedAccent();

// subscribe to Rust scan-progress / root-offline events for the whole session
// (a plain browser preview has no IPC — surface it, never leave it unhandled)
initScanListener().catch((e) => console.warn("scan listener unavailable:", e));
initOfflineListener().catch((e) => console.warn("offline listener unavailable:", e));
// P7 F2: resolve the CLI file BEFORE the first paint. With a boot file the
// html gets `boot-viewer` (pure black, #root hidden) so the gallery never
// flashes for even one frame — the viewer opens as a portal over the black
// surface and removes the class when it mounts.
const bootFile = await resolveBootFile();
if (bootFile) document.documentElement.classList.add("boot-viewer");

// file from Explorer / second launch / drag onto the window → fullscreen viewer
initExternalOpen(bootFile);

async function resolveBootFile(): Promise<string | null> {
  if (!tauriAvailable()) return null;
  try {
    const args: string[] = await invoke("cli_args");
    return args.find((a) => a !== "lumen" && /^[A-Za-z]:\\/.test(a)) ?? null;
  } catch {
    return null; // browser QA — no IPC
  }
}

async function bootstrap() {
  // apply the persisted/system language BEFORE the first render
  const saved = await readSavedLang();
  await initI18n(saved);
  await applyCursorPreference().catch(() => undefined);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <Routes>
            <Route path="/" element={<App />} />
            {/* hidden living style sheet */}
            <Route path="/style" element={<StylePage />} />
            {/* onboarding is also reachable directly for QA/screenshots */}
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/asset-test" element={<AssetTest />} />
            {/* dev-only grid QA surface (synthetic rows, no Tauri calls) */}
            <Route path="/grid-demo" element={<GridDemo />} />
            {/* F5: the custom mini-player lives in its own frameless window */}
            <Route path="/miniplayer" element={<MiniPlayer />} />
          </Routes>
        </HashRouter>
        {/* P9 motion/density: three toasts is a stack, four is a wall. Older
            ones collapse behind the newest (sonner's own spring), and the panel
            matches the app's control tokens instead of the library default. */}
        <Toaster
          position="bottom-right"
          visibleToasts={3}
          gap={10}
          offset={18}
          closeButton={false}
          toastOptions={{
            style: {
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              borderRadius: "var(--radius-control)",
              boxShadow: "var(--shadow-popover)",
              padding: "12px 14px",
              fontSize: "13px",
            },
          }}
        />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();