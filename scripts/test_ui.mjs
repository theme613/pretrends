import { chromium } from "playwright";
import assert from "node:assert/strict";

// Run against npm run dev. Scan and preview requests are mocked: no paid work.
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const origin = process.env.TEST_URL || "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/previews?*", (route) => route.fulfill({ contentType: "image/png", body: png }));
    await page.goto(origin);
    const card = page.locator(".trend-card").first();
    await card.waitFor();
    assert.equal(await page.locator(".trend-card .prediction-view").count(), await page.locator(".trend-card").count());
    await card.locator(".preview-open img").waitFor();
    for (const trigger of [".preview-open", ".card-open", ".card-action"]) {
      await card.locator(trigger).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction((selector) => document.activeElement === document.querySelector(`.trend-card ${selector}`), trigger);
    }
    await card.locator(".bookmark-button").click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await card.locator(".bookmark-button").getAttribute("aria-pressed"), "true");
    await card.locator(".card-action").focus(); await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    let finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    await page.route("**/api/scan**", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 202, json: { id: "mock" } });
      await gate;
      return route.fulfill({ json: { status: "complete", revision: 1, data: { candidates: [] }, result: { data: { candidates: [] } } } });
    });
    await page.getByRole("button", { name: "Find fresh ideas" }).click();
    await card.locator(".card-action").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".detail-caption summary").click();
    await dialog.locator("textarea").fill("Keep my edited brief");
    finish();
    await dialog.getByText("This post is no longer available", { exact: false }).waitFor();
    assert.equal(await dialog.locator("textarea").inputValue(), "Keep my edited brief");
    assert.equal(await dialog.getByText("Current views", { exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => document.activeElement === document.getElementById("ideas"));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS popup, save, keyboard, scan updates and layout ${viewport.width}px`);
  }
  for (const width of [1440, 390]) {
    const batchPage = await browser.newPage({ viewport: { width, height: 900 } });
    const response = await batchPage.request.get(`${origin}/api/trends`);
    const stored = await response.json();
    assert.ok(stored.length >= 24, "Browser batch checks need at least 24 eligible saved posts");
    const ids = stored.slice(-12).map((post) => `${post.platform}:${post.id}`);
    const data = stored.map((post, index) => ({ ...post, has_baseline: index === 0, baseline_at: new Date(Date.parse(post.collected_at) - 7200000).toISOString(), views_t0: 100, views_t1: 200 }));
    let small = false, conflict = false;
    await batchPage.route("**/api/previews?*", (route) => route.fulfill({ contentType: "image/png", body: png }));
    await batchPage.route("**/api/scan**", (route) => {
      if (conflict) return route.fulfill({ status: 409, json: { error: "Another scan is already running with different filters. Wait for it to finish, then try again." } });
      const candidates = small ? data.slice(-3) : data;
      const batch = { ids: small ? ids.slice(-3) : ids, fresh_count: small ? 0 : 3, reused_count: small ? 3 : 9 };
      return route.fulfill({ json: { batch, data: { candidates } } });
    });
    await batchPage.goto(origin);
    await batchPage.getByRole("button", { name: "Find fresh ideas" }).click();
    await batchPage.getByText("12 ideas ready · 3 fresh, 9 saved.", { exact: true }).waitFor();
    assert.equal(await batchPage.locator(".trend-card").count(), 12);
    const titles = await batchPage.locator(".card-open").allTextContents();
    assert.deepEqual([...titles].sort(), stored.slice(-12).map((post) => post.title).sort());
    assert.equal(await batchPage.locator(".trend-card .collecting-note").count(), 12);
    await batchPage.getByRole("textbox", { name: "Search ideas" }).fill(titles[0]);
    assert.ok(await batchPage.locator(".trend-card").count() >= 1);
    assert.ok(await batchPage.locator(".trend-card").count() < 12);
    await batchPage.getByRole("button", { name: "Clear search" }).click();
    assert.equal(await batchPage.locator(".trend-card").count(), 12);
    await batchPage.getByRole("button", { name: "All ideas", exact: true }).click();
    assert.equal(await batchPage.locator(".trend-card").getByText("Refresh batch", { exact: true }).count(), 0);
    await batchPage.getByRole("button", { name: "Find fresh ideas" }).click();
    await batchPage.locator(".trend-card").getByText("Refresh batch", { exact: true }).first().waitFor();
    await batchPage.locator(".card-action").first().click();
    const details = batchPage.getByRole("dialog");
    await details.locator(".collecting-note").waitFor();
    assert.equal(await details.locator(".collecting-data-val").textContent(), "Collecting data");
    await details.locator(".detail-caption summary").click();
    await details.locator("textarea").fill("My final hackathon brief");
    await batchPage.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await details.getByRole("button", { name: "Copy post brief" }).click();
    await details.getByRole("button", { name: "Brief copied" }).waitFor();
    assert.match(await batchPage.evaluate(() => navigator.clipboard.readText()), /My final hackathon brief/);
    await batchPage.keyboard.press("Escape");
    await batchPage.getByRole("button", { name: /Show next 12 ideas/ }).click();
    assert.equal(await batchPage.locator(".trend-card").count(), 24);
    await batchPage.getByRole("button", { name: "Find fresh ideas" }).click();
    await batchPage.waitForFunction(() => document.querySelectorAll(".trend-card").length === 12);
    small = true;
    await batchPage.getByRole("button", { name: "Find fresh ideas" }).click();
    await batchPage.getByText(/3 ideas ready · 0 fresh, 3 saved/).waitFor();
    assert.equal(await batchPage.locator(".trend-card").count(), 3);
    conflict = true;
    await batchPage.getByRole("button", { name: "Find fresh ideas" }).click();
    await batchPage.getByText(/Another scan is already running with different filters/).waitFor();
    assert.equal(await batchPage.locator(".trend-card").count(), 3);
    await batchPage.close();
    console.log(`PASS predictions, 12-post batch, load more, shortage, clipboard and scan conflict ${width}px`);
  }
  const page = await browser.newPage();
  await page.clock.install();
  let recover = false;
  await page.route("**/api/previews?*", (route) => recover ? route.fulfill({ contentType: "image/png", body: png }) : route.fulfill({ status: 503 }));
  await page.goto(origin);
  const card = page.locator(".trend-card").first();
  await card.getByRole("button", { name: "Retry preview" }).waitFor();
  recover = true;
  await card.getByRole("button", { name: "Retry preview" }).click();
  await card.locator("img").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.reload(); await card.locator("img").waitFor();
  console.log("PASS preview failure, retry and reload");
  await page.close();
  const stalled = await browser.newPage();
  await stalled.route("**/api/previews?*", () => {});
  await stalled.route("**/api/scan**", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, json: { id: "stalled" } });
    // Leave polling pending to exercise the real network timeout.
  });
  await stalled.goto(origin);
  await stalled.getByRole("button", { name: "Find fresh ideas" }).click();
  await stalled.getByText("Could not update ideas. Please try again.", { exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await stalled.getByRole("button", { name: "Find fresh ideas" }).isEnabled(), true);
  await stalled.locator(".trend-card").first().getByRole("button", { name: "Retry preview" }).waitFor({ timeout: 65000 });
  await stalled.locator(".card-action").first().click();
  await stalled.getByRole("dialog").waitFor();
  console.log("PASS stalled preview timeout and interrupted scan recovery");
  await stalled.close();
} finally { await browser.close(); }
