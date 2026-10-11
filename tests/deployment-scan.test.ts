import assert from "node:assert/strict";
import { test } from "node:test";
import { contentCheckKey, contentFingerprint, createAnalysisSession, fallback, processCandidates, type TrendCandidate } from "../src/lib/agent";
import { scrape } from "../src/lib/apify";
import { CONTENT_CHECK_VERSION } from "../src/lib/post-policy";
import { createScanJob, runScan, scanOptions } from "../src/lib/scan-runner";

function savedPost(id = "7546234572208377101"): TrendCandidate {
  const now = new Date().toISOString();
  const source = { id, platform: "TikTok", title: "Cooking soup", creator: "chef",
    url: `https://www.tiktok.com/@chef/video/${id}`, video_url: "https://v.tiktokcdn.com/video.mp4",
    collected_at: now, views_t0: null, views_t1: 200,
    source_status: "available" as const, source_verified_at: now, source_run_id: "saved-source" };
  return { ...fallback(source), categories: ["food"],
    category_evidence: [{ category: "food", activity: "cooking_food", frames: [1, 2, 3], active: true, description: "Hands stirring soup." }],
    ai_status: "complete", content_status: "verified", content_check_version: CONTENT_CHECK_VERSION,
    content_fingerprint: contentFingerprint(source), content_checked_at: now };
}

const rawPost = (post = savedPost()) => ({ id: post.id, url: post.url, views: post.views_t1, caption: post.title });
const visualResult = () => ({ categories: ["food"], category_evidence: savedPost().category_evidence!,
  score: 0.5, reason: "Visible cooking.", decision: "Show your recipe.", steps: ["Prepare.", "Cook.", "Share."],
  ai_usage: { model: "test", input_tokens: 1, output_tokens: 1 } });

test("Vercel scans reserve time for checks and finish within the route limit without increasing spending", async () => {
  const original = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    for (const mode of ["refresh", "prepare"] as const) {
      const post = savedPost();
      const job = createScanJob(scanOptions({ mode, platform: "TikTok" }));
      const started = Date.parse(job.started_at);
      await runScan(job, {
        read: async () => [], save: async () => undefined, latest: async () => [post],
        scrape: async (_platform, _topics, _limit, _known, options) => {
          assert.equal(options?.deadline, started + 120000);
          assert.equal(options?.maxChargeUsd, mode === "refresh" ? 0.25 : 1);
          return { posts: [post], verifications: [], warnings: [], run_id: "test", scrape_ms: 1 };
        },
        process: async (_posts, _progress, _checks, deadline, options) => {
          assert.equal(deadline, started + 260000);
          assert.equal(options?.session?.maxNewChecks, mode === "refresh" ? 12 : 250);
          assert.equal(options?.session?.maxAttempts, mode === "refresh" ? 15 : 300);
          await options?.onResult?.(post);
          return [post];
        },
      });
      assert.equal(job.status, "complete");
    }
  } finally {
    if (original === undefined) delete process.env.VERCEL; else process.env.VERCEL = original;
  }
});

test("temporary scraper failures keep fresh saved ideas and report that no new posts were collected", async () => {
  const post = savedPost();
  const writes: Array<{ candidates: TrendCandidate[]; verifications?: Array<{ status: string }> }> = [];
  const job = createScanJob(scanOptions({}));
  await runScan(job, {
    read: async () => [{ timestamp: post.collected_at, candidates: [post] }],
    latest: async () => [post], save: async (scan) => { writes.push(scan); },
    scrape: async () => { throw new Error("Scraper temporarily unavailable"); },
    process: async () => { throw new Error("No media check should run"); },
  });
  assert.equal(job.status, "complete");
  assert.equal(job.result?.scraped_count, 0);
  assert.equal(job.result?.batch.reused_count, 1);
  assert(job.warnings.some((warning) => warning.includes("saved ideas are still available")));
  assert(writes.every((scan) => !scan.verifications?.length));
  assert.equal(job.result?.data.candidates[0].source_verified_at, post.source_verified_at);
});

test("missing or blocked scraper rows do not revoke saved checks, but deleted and private posts do", async () => {
  const previousFetch = globalThis.fetch;
  const post = savedPost();
  try {
    for (const row of [undefined, { inputUrl: post.url, error: "blocked" },
      { inputUrl: post.url, error: "not-found" }, { inputUrl: post.url, isPrivate: true }]) {
      globalThis.fetch = async (input) => String(input).includes("/runs?")
        ? Response.json({ data: { id: "run", status: "SUCCEEDED", defaultDatasetId: "dataset" } })
        : Response.json(row ? [row] : []);
      const result = await scrape("TikTok", ["cooking"], 20, [post], { deadline: Date.now() + 120000 });
      assert.deepEqual(result.verifications.map((entry) => entry.status),
        row && (row.error === "not-found" || "isPrivate" in row) ? ["unavailable"] : []);
    }
  } finally { globalThis.fetch = previousFetch; }
});

test("a scraper reaching its collection deadline is stopped and its partial rows are retained", async () => {
  const previousFetch = globalThis.fetch, previousNow = Date.now;
  let now = previousNow();
  const initial = now;
  const requests: string[] = [];
  Date.now = () => now;
  try {
    globalThis.fetch = async (input, options) => {
      const url = String(input); requests.push(url);
      assert(options?.signal);
      if (url.includes("/runs?")) {
        assert(url.includes("timeout=10&maxTotalChargeUsd=0.25"));
        now += 11000;
        return Response.json({ data: { id: "run", status: "RUNNING", defaultDatasetId: "dataset" } });
      }
      if (url.endsWith("/abort")) {
        assert.equal(options?.method, "POST");
        return Response.json({ data: { id: "run", status: "ABORTED" } });
      }
      return Response.json([rawPost()]);
    };
    const result = await scrape("TikTok", ["cooking"], 20, [], { deadline: initial + 30000, maxChargeUsd: 0.25 });
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].source_status, "available");
    assert(requests.some((url) => url.endsWith("/abort")));
    assert(result.warnings.some((warning) => warning.includes("time limit")));
  } finally { globalThis.fetch = previousFetch; Date.now = previousNow; }
});

test("a later failed dataset page preserves valid rows already read", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/runs?")) return Response.json({ data: { id: "run", status: "TIMED-OUT", defaultDatasetId: "dataset" } });
      if (url.includes("offset=0")) return Response.json([rawPost(), ...Array.from({ length: 99 }, () => ({ error: "blocked" }))]);
      return Response.json({}, { status: 500 });
    };
    const result = await scrape("TikTok", ["cooking"], 20, [], { deadline: Date.now() + 120000 });
    assert.equal(result.posts.length, 1);
    assert(result.warnings.some((warning) => warning.includes("HTTP 500")));
  } finally { globalThis.fetch = previousFetch; }
});

test("scraper requests cannot wait beyond the collection cutoff", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, options) => new Promise<Response>((_resolve, reject) => {
      assert(options?.signal);
      options.signal.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
    // Keep the test process alive while the unref'ed AbortSignal timer fires.
    const keepAlive = setTimeout(() => undefined, 1000);
    const started = Date.now();
    try {
      await assert.rejects(scrape("TikTok", ["cooking"], 20, [], { deadline: started + 20030 }), /did not respond/);
      assert(Date.now() - started < 1000);
    } finally { clearTimeout(keepAlive); }
  } finally { globalThis.fetch = previousFetch; }
});

test("checks near the deadline reuse saved evidence but do not start fresh downloads or AI", async () => {
  const cached = savedPost(), fresh = savedPost("7546234572208377102");
  const session = createAnalysisSession();
  const results = await processCandidates([cached, fresh], undefined, new Map([[contentCheckKey(cached), cached]]), Date.now() + 59000, {
    session, extract: async () => { throw new Error("Must not download"); }, analyze: async () => { throw new Error("Must not call AI"); },
  });
  assert.equal(results[0].content_status, "verified");
  assert.equal(results[1].content_status, "unavailable");
  assert.match(results[1].check_error || "", /Not enough time/);
  assert.equal(session.cacheHits, 1);
  assert.equal(session.newChecks, 0);
});

test("a transient visual request failure does not stop later candidates from being checked", async () => {
  let calls = 0;
  const session = createAnalysisSession();
  const results = await processCandidates([savedPost(), savedPost("7546234572208377102")], undefined, undefined, undefined, {
    session, extract: async () => ["frame-one", "frame-two", "frame-three"],
    analyze: async () => { if (++calls === 1) throw new Error("Grafilab did not respond to the visual check."); return visualResult(); },
  });
  assert.equal(calls, 2);
  assert.equal(session.stopped, "");
  assert.equal(results[1].content_status, "verified");
});
