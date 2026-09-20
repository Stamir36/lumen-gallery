import { defineConfig, devices } from "@playwright/test";

/**
 * LUMEN — visual regression tests.
 *
 * The app runs in a plain browser against the Vite dev server: every QA
 * surface (`#/grid-demo`, `#/style`, `#/settings`) is built to work without
 * the Tauri runtime (`tauriAvailable()` gates the IPC). Screenshots are
 * compared against `e2e/__screenshots__` on re-runs; the first run records
 * baselines (`pnpm e2e --update-snapshots`).
 *
 * Determinism contract for pixel diffs:
 *  - animations OFF (motion-reduce class + Playwright `reducedMotion`),
 *  - clocks frozen via fake timers where the UI renders time,
 *  - fonts awaited explicitly (waitForFunction document.fonts.ready).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "ru-RU",
  },
  webServer: {
    command: "pnpm dev -- --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
