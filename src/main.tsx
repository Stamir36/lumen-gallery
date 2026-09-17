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
import { initI18n, readSavedLang, applyCursorPreference } from "./i18n";
import { initScanListener, initOfflineListener } from "./state/library";
import { queryClient } from "./lib/queryClient";
import { startPerfWatchdog } from "./lib/perf";
import "./index.css";

// frame-rate + long-task watchdog: an "it froze" report should come with numbers
startPerfWatchdog();

// subscribe to Rust scan-progress / root-offline events for the whole session
// (a plain browser preview has no IPC — surface it, never leave it unhandled)
initScanListener().catch((e) => console.warn("scan listener unavailable:", e));
initOfflineListener().catch((e) => console.warn("offline listener unavailable:", e));

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
          </Routes>
        </HashRouter>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              borderRadius: "var(--radius-control)",
              boxShadow: "var(--shadow-popover)",
            },
          }}
        />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();