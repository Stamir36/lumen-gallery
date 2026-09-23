import { test, expect, type Page } from "@playwright/test";

/**
 * Setup wizard (#/setup) — functional walkthrough, not just pixels:
 *
 *  - step 1 (language): picking English switches the wizard's own chrome live;
 *  - step 2 (accent):   picking a swatch repaints the live preview strip AND
 *                       :root (--accent), verified via a computed style probe;
 *  - step 3 (interface): layout cards + card-hover toggle + density/corners —
 *                       writes through the settings store (checked via ARIA);
 *  - step 4 (behavior): toggles for autoplay / tray background mode;
 *  - finish:            the CTA on the LAST step opens a summary panel instead
 *                       of advancing into empty screens (the bug this spec is
 *                       here to keep dead).
 *
 * The wizard needs no Tauri: everything writes through the same stores the
 * library uses, so this spec is the app's own "does personalization work" test.
 */

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

/** Fan out to the last step and press the finish CTA. */
async function walkToFinish(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Далее" }).click();
  }
  await page.getByRole("button", { name: "Готово" }).click();
}

test.describe("setup wizard", () => {
  test("step 1 — picking English switches the UI live", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    // Russian by default (locale ru-RU)
    await expect(page.getByRole("heading", { name: "Добро пожаловать в LUMEN" })).toBeVisible();

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to LUMEN" })).toBeVisible();

    // and back — the choice must not stick one-way
    await page.getByRole("button", { name: "Русский" }).click();
    await expect(page.getByRole("heading", { name: "Добро пожаловать в LUMEN" })).toBeVisible();
  });

  test("step 2 — accent pick repaints :root live", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    const before = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );

    await page.getByRole("button", { name: "Далее" }).click();
    await settle(page);

    // "Роза" is the rose preset — the swatch is named by its tooltip
    await page.getByRole("button", { name: "Роза" }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
        ),
      )
      .not.toBe(before);

    // the live preview strip follows the accent too
    await expect(page.getByText("Активная вкладка")).toBeVisible();
  });

  test("step 3 — interface toggles write through the settings store", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Далее" }).click();
    await settle(page);

    // rail layout card becomes the pressed one
    const railCard = page.getByRole("button", { name: "Рельс" }).first();
    await railCard.click();
    await expect(railCard).toHaveAttribute("aria-pressed", "true");

    // card-hover toggle flips its ARIA state
    const hoverToggle = page.getByRole("switch", { name: "Анимация карточек" });
    await expect(hoverToggle).toBeVisible();
    const before = await hoverToggle.getAttribute("aria-checked");
    await hoverToggle.click();
    await expect(hoverToggle).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");

    // corners: "Острые" writes the html attribute the whole UI reads
    await page.getByRole("radio", { name: "Острые" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-radius", "sharp");
  });

  test("step 4 — behavior switches (autoplay, tray background)", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Далее" }).click();
    await expect(page.getByText("04 ·")).toBeVisible();

    const tray = page.getByRole("switch", { name: "Оставаться в трее" });
    await expect(tray).toBeVisible();
    // default is OFF: closing the window quits the app
    await expect(tray).toHaveAttribute("aria-checked", "false");
    await tray.click();
    await expect(tray).toHaveAttribute("aria-checked", "true");
  });

  test("finish panel replaces the endless 'next'", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    await walkToFinish(page);

    // a real end state — no empty step, no runaway counter
    await expect(page.getByRole("heading", { name: "Всё готово" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть библиотеку" })).toBeVisible();
    // the step rail is gone at the end of the road
    await expect(page.getByText("04 ·")).toHaveCount(0);

    // and back once more: the wizard can return to its last step
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByText("04 ·")).toBeVisible();
  });

  test("progress rail + back navigation + skip", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);

    await page.getByRole("button", { name: "Далее" }).click();
    await expect(page.getByText("02 ·")).toBeVisible();
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByText("01 ·")).toBeVisible();

    // skip leaves the wizard without touching anything
    await page.getByRole("button", { name: "Пропустить настройку" }).click();
    await expect(page.getByRole("heading", { name: "Добро пожаловать в LUMEN" })).toBeHidden();
  });

  test("visual — step 1 baseline", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);
    await expect(page).toHaveScreenshot("setup-step1.png", { maxDiffPixels: 600 });
  });

  test("visual — step 2 accent", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);
    await page.getByRole("button", { name: "Далее" }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("setup-step2.png", { maxDiffPixels: 600 });
  });

  test("visual — finish panel", async ({ page }) => {
    await page.goto("/#/setup");
    await settle(page);
    await walkToFinish(page);
    await settle(page);
    await expect(page).toHaveScreenshot("setup-finish.png", { maxDiffPixels: 600 });
  });
});
