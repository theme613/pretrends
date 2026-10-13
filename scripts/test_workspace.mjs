import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { launchBrowser } from "./browser.mjs";

const browser = await launchBrowser();
const origin = process.env.TEST_URL || "http://127.0.0.1:3000";
await mkdir("test-results", { recursive: true });
async function navigate(page, id) {
  await page.goto(`${origin}/#${id}`);
  await page.waitForFunction(
    (id) =>
      document.querySelector(".workspace-topbar > div > span:last-child")
        ?.textContent ===
      {
        discover: "Discover",
        saved: "Saved ideas",
        planner: "Content planner",
        settings: "Workspace settings",
      }[id],
    id,
  );
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "Page must fit the viewport",
  );
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let paidCalls = 0;
    // A planner journey must never start a live search.
    await page.route("**/api/scan**", (route) => {
      paidCalls++;
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected paid call" },
      });
    });
    await navigate(page, "discover");
    await page
      .getByRole("heading", { name: "Start with a format that fits." })
      .waitFor();
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/discover-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: /BUILD CONNECTION.*A little behind the scenes/,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Post title").fill("Our morning coffee ritual");
    await dialog
      .getByLabel("Caption & opening hook")
      .fill("Freshly ground. Made for your morning. ☕");
    await dialog
      .getByLabel("Shot list & notes")
      .fill("1. Grind beans\n2. Pull the shot\n3. Pour the milk");
    await dialog
      .getByLabel("Platform", { exact: true })
      .selectOption("Instagram");
    await dialog
      .getByRole("button", { name: "Save post", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Edit Our morning coffee ritual",
        exact: true,
      })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", {
        name: "Edit Our morning coffee ritual",
        exact: true,
      })
      .click();
    assert.equal(
      await dialog.getByLabel("Caption & opening hook").inputValue(),
      "Freshly ground. Made for your morning. ☕",
    );
    assert.equal(
      await dialog.getByLabel("Shot list & notes").inputValue(),
      "1. Grind beans\n2. Pull the shot\n3. Pour the milk",
    );
    await dialog.getByLabel("Status", { exact: true }).selectOption("planned");
    await dialog
      .getByRole("button", { name: "Save post", exact: true })
      .click();
    assert.equal(
      await dialog.isVisible(),
      true,
      "Planned posts require a date",
    );
    await dialog.getByLabel("Planned date").fill("2026-10-20");
    await dialog
      .getByRole("button", { name: "Save post", exact: true })
      .click();
    await page.locator(".column-planned .plan-card").waitFor();
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/planner-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("textbox", { name: "Search content plan" })
      .fill("unmatched-query");
    assert.equal(await page.locator(".plan-card").count(), 0);
    await page.getByRole("button", { name: "Clear workspace search" }).click();
    await page
      .getByRole("button", { name: "Delete Our morning coffee ritual" })
      .click();
    assert.equal(await page.locator(".plan-card").count(), 0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.locator(".column-planned .plan-card").waitFor();
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const csv = await readFile(await (await csvDownload).path(), "utf8");
    assert.match(csv, /Our morning coffee ritual/);
    assert.match(csv, /2026-10-20/);
    await navigate(page, "settings");
    await page.getByLabel("Business name").fill("Luna Café");
    await page.reload();
    await page.getByLabel("Business name").waitFor();
    assert.equal(
      await page.getByLabel("Business name").inputValue(),
      "Luna Café",
    );
    const backupDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const backup = await readFile(await (await backupDownload).path());
    assert.equal(JSON.parse(backup).drafts.length, 1);
    await page
      .getByLabel("Import workspace backup")
      .setInputFiles({
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":2}'),
      });
    await page
      .getByText("This is not a supported Pretrends backup.", { exact: true })
      .waitFor();
    const secondContext = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const restored = await secondContext.newPage();
    await navigate(restored, "settings");
    await restored
      .getByLabel("Import workspace backup")
      .setInputFiles({
        name: "workspace.json",
        mimeType: "application/json",
        buffer: backup,
      });
    await restored
      .getByText(
        "Backup imported. Existing work is kept; newer drafts are merged.",
      )
      .waitFor();
    await navigate(restored, "planner");
    await restored.locator(".column-planned .plan-card").waitFor();
    await secondContext.close();
    // Separate tabs share changes without reloading.
    const tab = await context.newPage();
    await navigate(tab, "settings");
    await page.getByLabel("Business name").fill("Luna Studio");
    await tab.waitForFunction(
      () =>
        document.querySelector('input[maxlength="80"]')?.value ===
        "Luna Studio",
    );
    await tab.close();
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/settings-${width}.png`,
      fullPage: true,
    });
    await navigate(page, "planner");
    await page
      .getByRole("button", {
        name: "Edit Our morning coffee ritual",
        exact: true,
      })
      .click();
    await dialog
      .getByLabel("Status", { exact: true })
      .selectOption("published");
    await dialog
      .getByRole("button", { name: "Save post", exact: true })
      .click();
    await page.locator(".column-published .plan-card").waitFor();
    await page.getByRole("button", { name: "New post", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    assert.equal(paidCalls, 0);
    await context.close();
    console.log(
      `PASS complete planner journey, persistence, dates, search, delete/undo, CSV, backup restore, tab sync and layout ${width}px`,
    );
  }
  // Invalid browser data must not crash or silently overwrite the existing file.
  const context = await browser.newContext();
  await context.addInitScript(() =>
    localStorage.setItem("pretrends.workspace.v1", "invalid-json"),
  );
  const page = await context.newPage();
  await navigate(page, "settings");
  await page
    .getByRole("alert")
    .filter({ hasText: "Browser storage" })
    .waitFor();
  await page.getByLabel("Business name").fill("Temporary business");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("pretrends.workspace.v1")),
    "invalid-json",
  );
  await context.close();
  console.log(
    "PASS corrupted storage recovery notice preserves the original data",
  );
} finally {
  await browser.close();
}
