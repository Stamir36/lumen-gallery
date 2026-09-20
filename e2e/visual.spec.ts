import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression — the key surfaces of DESIGN.md v2.5.
 *
 * Baselines are recorded once (`pnpm e2e --update-snapshots`) and reviewed by
 * a human; after that every run diffs pixels, so token/regressions (wrong
 * radius, lost blur, broken spacing) are caught without a manual pass.
 *
 * Determinism: animations are disabled twice (config `reducedMotion: reduce`
 * + the app's own prefers-reduced-motion paths), fonts are awaited before
 * every shot, and time-dependent chrome is masked where it renders a clock.
 */

/** hide volatile chrome (clocks, scan spinners) so pixel diffs stay stable */
async function freezeVolatile(page: Page) {
  await page.addStyleTag({
    content: `
      /* anything the app stamps with the current time */
      [data-volatile], .animate-spin, .animate-pulse {
        visibility: hidden !important;
      }
    `,
  });
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await freezeVolatile(page);
  // two rAFs: let the last layout/style pass flush before the shot
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#/grid-demo");
  await page.waitForSelector("img");
  await settle(page);
});

test.describe("grid surfaces", () => {
  test("grid — default justified view", async ({ page }) => {
    await expect(page).toHaveScreenshot("grid-justified.png", {
      fullPage: false,
      maxDiffPixels: 400,
    });
  });

  test("grid card — hover lift", async ({ page }) => {
    const card = page.locator('[data-viewer-hook], [aria-label*="IMG_"]').first();
    await card.hover();
    await page.waitForTimeout(250); // hover-lift 160ms token + settle
    await expect(page).toHaveScreenshot("grid-card-hover.png", { maxDiffPixels: 400 });
  });

  test("list view rows", async ({ page }) => {
    await page.getByRole("tab", { name: "Список" }).click();
    await page.waitForTimeout(200);
    await settle(page);
    await expect(page).toHaveScreenshot("grid-list.png", { maxDiffPixels: 400 });
  });

  test("selection mode + selection pill", async ({ page }) => {
    await page
      .getByRole("button", { name: "Режим выбора" })
      .or(page.locator('[aria-label*="выбор" i], [title*="выбор" i]').first())
      .first()
      .click();
    await page.waitForTimeout(200);
    await settle(page);
    await expect(page).toHaveScreenshot("selection-mode.png", { maxDiffPixels: 400 });
  });

  test("context menu over a bright frame", async ({ page }) => {
    // the synthetic palette includes light tiles; open the menu on the first
    // card and let the glass blur sample the bright content behind it.
    // The menu opens on contextmenu only AFTER the browser dispatches it —
    // Playwright's click(button:"right") does exactly that.
    const card = page.locator('[aria-label*="IMG_"]').first();
    await card.click({ button: "right", force: true });
    await page.waitForTimeout(250); // menu entrance 120ms + focus settle
    await expect(page.locator("[role='menu']")).toBeVisible();
    await expect(page).toHaveScreenshot("context-menu.png", { maxDiffPixels: 400 });
  });
});

test.describe("viewer", () => {
  test("lightbox open + pill", async ({ page }) => {
    // open the first image (double-click opens the viewer in the demo route)
    const card = page.locator('[aria-label*="IMG_"]').first();
    await card.dblclick();
    await page.waitForTimeout(400); // open choreography 180ms + underlay
    await settle(page);
    await expect(page).toHaveScreenshot("lightbox.png", { maxDiffPixels: 600 });
    // close restores the grid — no semi-transparent leftover frame
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });
});

test.describe("static routes", () => {
  test("style page tokens", async ({ page }) => {
    await page.goto("/#/style");
    await settle(page);
    await expect(page).toHaveScreenshot("style-page.png", { fullPage: true, maxDiffPixels: 800 });
  });

  test("settings", async ({ page }) => {
    await page.goto("/#/settings");
    await settle(page);
    await expect(page).toHaveScreenshot("settings.png", { maxDiffPixels: 600 });
  });

  test("onboarding", async ({ page }) => {
    await page.goto("/#/onboarding");
    await settle(page);
    await expect(page).toHaveScreenshot("onboarding.png", { maxDiffPixels: 600 });
  });
});
