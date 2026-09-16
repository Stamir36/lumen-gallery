import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import StylePage from "./pages/StylePage";
import { initScanListener } from "./state/library";
import "./index.css";

// subscribe to Rust scan-progress events for the whole session
initScanListener();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          {/* hidden living style sheet */}
          <Route path="/style" element={<StylePage />} />
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
