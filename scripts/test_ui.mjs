import { chromium } from "playwright";
import assert from "node:assert/strict";

// Run against npm run dev or npm start. All scan, recovery, and preview requests
// are mocked; these checks do not require saved posts or perform paid work.
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const origin = process.env.TEST_URL || "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const scanUrl = "**/api/scan**";
const fixtureTime = new Date(Date.now() - 1000).toISOString();
const allPosts = Array.from({ length: 33 }, (_, index) => {
  const id = String(7546234572208377101n + BigInt(index));
  return {
    id, platform: "TikTok", title: `Cooking idea ${String(index + 1).padStart(2, "0")}`, creator: "chef",
    url: `https://www.tiktok.com/@chef/video/${id}`, categories: ["food"],
    category_evidence: [{ category: "food", activity: "cooking_food", frames: [1, 2, 3], description: "Hands stir ingredients in a saucepan.", active: true }],
    source_status: "available", source_run_id: "ui-test", source_verified_at: fixtureTime,
    content_status: "verified", content_check_version: "visual-v3", ai_status: "complete",
    collected_at: fixtureTime, baseline_at: new Date(Date.parse(fixtureTime) - 7200000).toISOString(),
    has_baseline: index === 0, views_t0: 100, views_t1: 200, score: 90 - index,
    preview_key: (index + 1).toString(16).padStart(64, "0"),
    reason: "A simple cooking demonstration.", decision: "Try a short cooking video.",
  };
});
const posts = allPosts.slice(0, 30);
const freshPosts = allPosts.slice(30);
const result = (candidates = posts, batch) => ({ data: { candidates }, ...(batch ? { batch } : {}) });
async function waitForCount(page, count) {
  await page.waitForFunction((expected) => document.querySelectorAll(".trend-card").length === expected, count);
}
async function refresh(page) {
  await page.getByRole("button", { name: "Find fresh ideas", exact: true }).click();
  await page.getByRole("button", { name: "Find fresh ideas", exact: true }).waitFor();
}
async function seed(page) {
  const bootstrap = (route) => route.fulfill({ json: result() });
  await page.route(scanUrl, bootstrap);
  await page.route("**/api/trends", (route) => route.fulfill({ json: posts }));
  await page.goto(origin);
  await refresh(page);
  await waitForCount(page, 12);
  await page.unroute(scanUrl, bootstrap);
}
async function newPage(viewport) {
  const page = await browser.newPage({ ...(viewport ? { viewport } : {}) });
  await page.route("**/api/previews?*", (route) => route.fulfill({ contentType: "image/png", body: png }));
  return page;
}
async function installClock(page) {
  // Native AbortSignal.timeout is not driven by Playwright's clock. Bridge it to
  // browser timers so the production fetch aborts are exercised without waiting.
  await page.addInitScript(() => {
    AbortSignal.timeout = (delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), delay);
      return controller.signal;
    };
  });
  await page.clock.install();
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await newPage(viewport);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seed(page);
    const card = page.locator(".trend-card").first();
    assert.equal(await page.locator(".trend-card .prediction-view").count(), 12);
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
    await card.locator(".card-action").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    let finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    await page.route(scanUrl, async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 202, json: { id: "mock" } });
      await gate;
      return route.fulfill({ json: { status: "complete", revision: 1, data: { candidates: [] }, result: result([]) } });
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
    console.log(`PASS popup, save, keyboard, authoritative scan updates and layout ${viewport.width}px`);
  }
  for (const width of [1440, 390]) {
    const page = await newPage({ width, height: 900 });
    await seed(page);
    const ids = posts.slice(-12).map((post) => `${post.platform}:${post.id}`);
    let small = false, conflict = false;
    await page.route(scanUrl, (route) => {
      if (conflict) return route.fulfill({ status: 409, json: { error: "Another scan is already running with different filters. Wait for it to finish, then try again." } });
      const candidates = small ? posts.slice(-3) : posts;
      const batch = { ids: small ? ids.slice(-3) : ids, fresh_count: small ? 0 : 3, reused_count: small ? 3 : 9 };
      return route.fulfill({ json: result(candidates, batch) });
    });
    await refresh(page);
    await page.getByText("12 ideas ready · 3 fresh, 9 saved.", { exact: true }).waitFor();
    assert.equal(await page.locator(".trend-card").count(), 12);
    const titles = await page.locator(".card-open").allTextContents();
    assert.deepEqual([...titles].sort(), posts.slice(-12).map((post) => post.title).sort());
    assert.equal(await page.locator(".trend-card .collecting-note").count(), 12);
    await page.getByText("30 ideas to explore", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Search ideas" }).fill(titles[0]);
    await waitForCount(page, 1);
    await page.getByRole("button", { name: "Clear search" }).click();
    await waitForCount(page, 12);
    await page.getByRole("button", { name: "All ideas", exact: true }).click();
    assert.equal(await page.locator(".trend-card").getByText("Refresh batch", { exact: true }).count(), 0);
    await refresh(page);
    await page.locator(".card-action").first().click();
    const details = page.getByRole("dialog");
    await details.locator(".collecting-note").waitFor();
    assert.equal(await details.locator(".collecting-data-val").textContent(), "Collecting data");
    await details.locator(".detail-caption summary").click();
    await details.locator("textarea").fill("My final hackathon brief");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await details.getByRole("button", { name: "Copy post brief" }).click();
    await details.getByRole("button", { name: "Brief copied" }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /My final hackathon brief/);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Show next 12 ideas/ }).click();
    await waitForCount(page, 24);
    await refresh(page);
    assert.equal(await page.locator(".trend-card").count(), 24, "Refresh must preserve the expanded list");
    assert.equal(await page.locator(".trend-card").getByText("Refresh batch", { exact: true }).count(), 12);
    await page.getByRole("button", { name: /Show next .* ideas/ }).click();
    await waitForCount(page, 30);
    assert.deepEqual((await page.locator(".card-open").allTextContents()).sort(), posts.map((post) => post.title).sort());
    assert.equal(await page.getByRole("button", { name: /Show next .* ideas/ }).count(), 0);
    small = true;
    await refresh(page);
    await page.getByText(/3 ideas ready · 0 fresh, 3 saved/).waitFor();
    await waitForCount(page, 3);
    conflict = true;
    await refresh(page);
    await page.getByText(/Another scan is already running with different filters/).waitFor();
    assert.equal(await page.locator(".trend-card").count(), 3);
    await page.close();
    console.log(`PASS synchronous scan, full collection, expanded list, clipboard and scan conflict ${width}px`);
  }
  const failed = await newPage();
  await seed(failed);
  await failed.getByRole("button", { name: /Show next 12 ideas/ }).click();
  await waitForCount(failed, 24);
  const savedTitles = await failed.locator(".card-open").allTextContents();
  // A different Vercel instance can return an empty collection during recovery.
  await failed.route("**/api/trends", (route) => route.fulfill({ json: [] }));
  let missingConfiguration = false;
  const configurationError = "Add APIFY_TOKEN, OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN to Vercel environment variables and redeploy.";
  await failed.route(scanUrl, (route) => missingConfiguration
    ? route.fulfill({ status: 503, json: { code: "MISSING_CONFIGURATION", error: configurationError } })
    : route.fulfill({ status: 504, contentType: "text/html", body: "<html><body>FUNCTION_INVOCATION_TIMEOUT</body></html>" }));
  await refresh(failed);
  assert.deepEqual(await failed.locator(".card-open").allTextContents(), savedTitles);
  assert.match(await failed.locator(".status-message").textContent(), /timed out|taking longer|try again/i);
  assert.doesNotMatch(await failed.locator(".status-message").textContent(), /Unexpected token|FUNCTION_INVOCATION_TIMEOUT|<html>/);
  missingConfiguration = true;
  await refresh(failed);
  await failed.getByText("Fresh ideas are not set up on this website yet. Your saved ideas are still available.", { exact: true }).waitFor();
  assert.doesNotMatch(await failed.locator(".status-message").textContent(), /APIFY_TOKEN|OPENAI_API_KEY|BLOB_READ_WRITE_TOKEN/);
  assert.deepEqual(await failed.locator(".card-open").allTextContents(), savedTitles);
  await failed.close();
  console.log("PASS Vercel HTML timeout and missing configuration preserve existing cards");

  const delayed = await newPage();
  await installClock(delayed);
  await seed(delayed);
  let finishDelayed;
  const gate = new Promise((resolve) => { finishDelayed = resolve; });
  let postStarted;
  const started = new Promise((resolve) => { postStarted = resolve; });
  let pollingRequests = 0;
  await delayed.route(scanUrl, async (route) => {
    if (route.request().method() !== "POST") pollingRequests++;
    postStarted();
    await gate;
    return route.fulfill({ json: result(allPosts, { ids: [...posts.slice(-9), ...freshPosts].map((post) => `${post.platform}:${post.id}`), fresh_count: 3, reused_count: 9 }) });
  });
  await delayed.getByRole("button", { name: "Find fresh ideas" }).click();
  await started;
  await delayed.clock.fastForward(180000);
  await delayed.getByText("Still finding ideas. You can keep browsing.", { exact: true }).waitFor();
  assert.equal(await delayed.getByRole("button", { name: "Finding ideas…", exact: true }).isDisabled(), true);
  assert.equal(await delayed.locator(".trend-card").count(), 12);
  await delayed.locator(".card-action").first().click();
  await delayed.getByRole("dialog").waitFor();
  await delayed.keyboard.press("Escape");
  finishDelayed();
  await delayed.getByText("12 ideas ready · 3 fresh, 9 saved.", { exact: true }).waitFor();
  await delayed.getByText("33 ideas to explore", { exact: true }).waitFor();
  assert.deepEqual((await delayed.locator(".card-open").allTextContents()).sort(), [...posts.slice(-9), ...freshPosts].map((post) => post.title).sort());
  assert.equal(pollingRequests, 0, "A completed Vercel POST must not poll a process-local job");
  await delayed.close();
  console.log("PASS synchronous scan stays usable beyond both 60-second and 120-second limits");

  const preview = await browser.newPage();
  let recover = false;
  await preview.route("**/api/previews?*", (route) => recover ? route.fulfill({ contentType: "image/png", body: png }) : route.fulfill({ status: 503 }));
  await seed(preview);
  const card = preview.locator(".trend-card").first();
  await card.getByRole("button", { name: "Retry preview" }).waitFor();
  recover = true;
  await card.getByRole("button", { name: "Retry preview" }).click();
  await card.locator("img").waitFor();
  assert.equal(await preview.getByRole("dialog").count(), 0);
  await seed(preview);
  await card.locator("img").waitFor();
  await preview.close();
  console.log("PASS preview failure, retry and reload");

  const stalled = await browser.newPage();
  await installClock(stalled);
  await stalled.route("**/api/previews?*", () => {});
  await seed(stalled);
  let pollStarted;
  const polling = new Promise((resolve) => { pollStarted = resolve; });
  await stalled.route(scanUrl, (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, json: { id: "stalled" } });
    // Leave polling pending to exercise the client request timeout.
    pollStarted();
  });
  await stalled.getByRole("button", { name: "Find fresh ideas" }).click();
  await polling;
  await stalled.clock.fastForward(21000);
  await stalled.getByRole("button", { name: "Find fresh ideas", exact: true }).waitFor();
  assert.match(await stalled.locator(".status-message").textContent(), /timed out|try again/i);
  assert.equal(await stalled.locator(".trend-card").count(), 12);
  await stalled.clock.fastForward(61000);
  await stalled.locator(".trend-card").first().getByRole("button", { name: "Retry preview" }).waitFor();
  await stalled.locator(".card-action").first().click();
  await stalled.getByRole("dialog").waitFor();
  await stalled.close();
  console.log("PASS stalled preview timeout and interrupted scan recovery");
} finally { await browser.close(); }
