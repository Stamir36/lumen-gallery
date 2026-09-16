import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import StylePage from "./pages/StylePage";
import OnboardingPage from "./pages/OnboardingRoute";
import { initI18n, readSavedLang } from "./i18n";
import { initScanListener } from "./state/library";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

// subscribe to Rust scan-progress events for the whole session
initScanListener();

async function bootstrap() {
  // apply the persisted/system language BEFORE the first render
  const saved = await readSavedLang();
  await initI18n(saved);

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