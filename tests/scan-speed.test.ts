import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeFrames, contentCheckKey, contentChecksFromHistory, contentFingerprint, createAnalysisSession, fallback, processCandidates, type TrendCandidate } from "../src/lib/agent";
import { createScanJob, runScan, scanOptions } from "../src/lib/scan-runner";
import { CONTENT_CHECK_VERSION, isEligiblePost } from "../src/lib/post-policy";
import { scrape } from "../src/lib/apify";

function post(id = "7546234572208377101"): TrendCandidate {
  const time = new Date().toISOString();
  const raw = { id, platform: "TikTok", title: "Stirring soup", creator: "chef",
    url: `https://www.tiktok.com/@chef/video/${id}`, video_url: "https://v.tiktokcdn.com/video.mp4",
    views_t0: 100, views_t1: 200, collected_at: time, has_baseline: true,
    baseline_at: new Date(Date.now() - 7200000).toISOString(),
    source_status: "available" as const, source_verified_at: time, source_run_id: "source-run" };
  const result: TrendCandidate = { ...fallback(raw), categories: ["food"],
    category_evidence: [{ category: "food", activity: "cooking_food", frames: [1, 2, 3], active: true, description: "Hands stirring soup." }],
    ai_status: "complete", content_status: "verified", content_check_version: CONTENT_CHECK_VERSION,
    content_checked_at: time, reason: "Cooking is visible. Three frames were sampled.", decision: "Show your recipe.", steps: ["Prepare ingredients.", "Film stirring.", "Share the recipe."] };
  result.content_fingerprint = contentFingerprint(result);
  return result;
}
const guidance = () => ({ categories: ["food"], category_evidence: post().category_evidence!, score: 0.4,
  reason: "Cooking is visible. Three frames were sampled.", decision: "Show your recipe.", steps: ["Prepare.", "Film.", "Share."],
  ai_usage: { model: "test", input_tokens: 900, output_tokens: 250 } });
const frames = async () => ["one", "two", "three"];

test("refresh defaults, validation and preparation mode", () => {
  assert.equal(scanOptions({}).mode, "refresh");
  assert.equal(scanOptions({ mode: "prepare" }).mode, "prepare");
  assert.deepEqual(scanOptions({ categories: ["food", "food", "music", "invalid"] }).filters.categories, ["food", "music"]);
  assert.throws(() => scanOptions({ mode: "unlimited" }));
  assert.throws(() => scanOptions({ platform: "X" }));
});

test("history cache survives pending observations; count changes require no downloads or AI", async () => {
  const original = post();
  const pending = fallback({ ...original, views_t1: 900 });
  const checks = contentChecksFromHistory([{ candidates: [pending, original] }]);
  const session = createAnalysisSession(12, 15);
  const result = await processCandidates([{ ...original, views_t1: 900 }], undefined, checks, undefined, {
    session, extract: async () => { throw new Error("Must not download"); }, analyze: async () => { throw new Error("Must not call AI"); },
  });
  assert.equal(result[0].views_t1, 900);
  assert.equal(result[0].content_status, "verified");
  assert.equal(session.newChecks, 0); assert.equal(session.attempts, 0); assert.equal(session.cacheHits, 1);
});

test("uncertain content and temporary failures are cached only until their expiry", async () => {
  const original = post();
  for (const cached of [
    { ...original, categories: [], content_status: "uncertain" as const },
    { ...original, ...fallback(original), content_fingerprint: original.content_fingerprint, content_check_version: CONTENT_CHECK_VERSION,
      content_checked_at: original.content_checked_at, retry_after: new Date(Date.now() + 60000).toISOString() },
  ]) {
    let calls = 0;
    const session = createAnalysisSession();
    const checks = new Map([[contentCheckKey(cached), cached]]);
    await processCandidates([original], undefined, checks, undefined, { session, extract: frames, analyze: async () => { calls++; return guidance(); } });
    assert.equal(calls, 0);
    const expired = { ...cached, content_checked_at: new Date(Date.now() - 86400001).toISOString(), retry_after: "1970-01-01" };
    await processCandidates([original], undefined, new Map([[contentCheckKey(expired), expired]]), undefined,
      { extract: frames, analyze: async () => { calls++; return guidance(); } });
    assert.equal(calls, 1);
  }
});

test("two platform processors share the 12-check budget and at most three workers", async () => {
  const session = createAnalysisSession(12, 15);
  let active = 0, peak = 0, calls = 0;
  const options = { session, extract: frames, analyze: async () => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise((resolve) => setTimeout(resolve, 2)); active--; return guidance();
  } };
  await Promise.all([0, 100].map((offset) => processCandidates(
    Array.from({ length: 40 }, (_, index) => post(String(BigInt("7546234572208377000") + BigInt(offset + index)))),
    undefined, undefined, undefined, options,
  )));
  assert.equal(session.newChecks, 12); assert.equal(calls, 12); assert(peak <= 3);
});

test("in-flight duplicate posts are analyzed once and emitted with their own metrics", async () => {
  const session = createAnalysisSession(); let calls = 0;
  const original = post();
  const results = await processCandidates([original, { ...original, views_t1: 999 }], undefined, undefined, undefined,
    { session, extract: frames, analyze: async () => { calls++; return guidance(); } });
  assert.equal(calls, 1); assert.equal(results[1].views_t1, 999);
});

test("a failed compatibility check prevents bulk AI requests", async () => {
  let calls = 0;
  const result = await processCandidates([post(), post("7546234572208377102")], undefined, undefined, undefined,
    { extract: frames, analyze: async () => { calls++; throw new Error("AI returned invalid JSON for the visual check."); } });
  assert.equal(calls, 1); assert(result.every((entry) => entry.content_status !== "verified"));
});

test("AI attempts include retries, usage includes invalid output, and quota errors stop new work", async () => {
  const savedFetch = globalThis.fetch, key = process.env.GRAFILAB_API_KEY;
  process.env.GRAFILAB_API_KEY = "test-only";
  try {
    const capped = createAnalysisSession(12, 1); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "rate_limit" } }, { status: 429 }); };
    await assert.rejects(analyzeFrames(post(), await frames(), undefined, capped), /budget/);
    assert.equal(calls, 1); assert.equal(capped.attempts, 1);
    const quota = createAnalysisSession(); calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "insufficient_quota" } }, { status: 429 }); };
    await assert.rejects(analyzeFrames(post(), await frames(), undefined, quota), /insufficient_quota/);
    await assert.rejects(analyzeFrames(post(), await frames(), undefined, quota), /insufficient_quota/);
    assert.equal(calls, 1);
    const truncated = createAnalysisSession();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 500); assert.equal(body.reasoning_effort, "none");
      assert.equal(body.messages[1].content[0].text.length, 509);
      assert.equal(body.messages[1].content.filter((entry: { type: string }) => entry.type === "image_url").length, 3);
      return Response.json({ choices: [{ finish_reason: "length" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } });
    };
    await assert.rejects(analyzeFrames({ ...post(), caption: "x".repeat(1000) }, await frames(), undefined, truncated), /token limit/);
    assert.equal(truncated.inputTokens, 1000); assert.equal(truncated.outputTokens, 500);
  } finally { globalThis.fetch = savedFetch; if (key === undefined) delete process.env.GRAFILAB_API_KEY; else process.env.GRAFILAB_API_KEY = key; }
});

test("a successful platform publishes and persists results while the other is still collecting", async () => {
  let finishSlow!: () => void;
  const slow = new Promise<void>((resolve) => { finishSlow = resolve; });
  let published!: () => void;
  const first = new Promise<void>((resolve) => { published = resolve; });
  const saved: { candidates: TrendCandidate[] }[] = [];
  const job = createScanJob(scanOptions({ categories: ["food"] }));
  const running = runScan(job, {
    read: async () => [], latest: async () => saved.flatMap((entry) => entry.candidates).filter((entry) => isEligiblePost(entry)),
    save: async (scan) => { saved.push(scan); if (scan.candidates.some((entry) => entry.content_status === "verified")) published(); },
    scrape: async (platform, topics, limit, known, options) => {
      assert.deepEqual(topics, ["cooking"]); assert.equal(limit, 20); assert.equal(options?.maxChargeUsd, 0.25); assert(known!.length <= 5);
      if (platform === "Instagram") { await slow; return { posts: [], verifications: [], run_id: "slow", warnings: [], scrape_ms: 1000 }; }
      return { posts: [post()], verifications: [], run_id: "fast", warnings: [], scrape_ms: 1 };
    },
    process: async (posts, _progress, _previous, _deadline, options) => {
      assert.equal(options!.session!.maxNewChecks, 12);
      assert.equal(options!.session!.maxAttempts, 15);
      if (!posts.length) return [];
      const ready = { ...post(), ...posts[0], content_status: "verified" as const, categories: ["food"] };
      await options!.onResult!(ready); return [ready];
    },
  });
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(job.status, "running"); assert.equal(job.processed, 1);
  assert(job.revision > 0); assert.notEqual(job.metrics.first_result_ms, null);
  assert(saved.some((entry) => entry.candidates.some((candidate) => candidate.check_error === "Waiting for a visual check.")));
  finishSlow(); await running;
  assert.equal(job.status, "complete"); assert.equal(job.result?.verified_count, 1);
});

test("dataset pagination includes late known posts and applies per-URL limits and charge caps", async () => {
  const savedFetch = globalThis.fetch;
  const known = { ...post(), platform: "Instagram", short_code: "ABC", url: "https://www.instagram.com/reel/ABC/" };
  let pages = 0;
  try {
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/runs?")) {
        assert(url.includes("maxTotalChargeUsd=0.25"));
        const body = JSON.parse(String(options?.body));
        assert.equal(body.resultsLimit, 19); assert.equal(body.directUrls.length, 3);
        return Response.json({ data: { id: "run", status: "SUCCEEDED", defaultDatasetId: "data", usageTotalUsd: 0.25 } });
      }
      pages++;
      return Response.json(url.includes("offset=0") ? Array.from({ length: 100 }, () => ({ error: "blocked" })) :
        [{ id: known.id, shortCode: "ABC", url: known.url, videoPlayCount: 123, caption: "Real cooking" }]);
    };
    const result = await scrape("Instagram", ["cooking", "baking"], 40, [known], { maxChargeUsd: 0.25 });
    assert.equal(pages, 2); assert.equal(result.verifications[0].status, "available"); assert.equal(result.posts.length, 1); assert.equal(result.warnings.length, 1);
  } finally { globalThis.fetch = savedFetch; }
});

test("atomic collection index rebuilds, source failures hide immediately, history retains baselines", async () => {
  const originalCwd = process.cwd(), directory = await fs.mkdtemp(path.join(os.tmpdir(), "pretrends-store-test-"));
  process.chdir(directory);
  try {
    // Import in a separate process because the store directory is module-scoped.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { pathToFileURL } = await import("node:url");
    const script = `import { saveScan, latestTrends, readScans } from ${JSON.stringify(pathToFileURL(path.join(originalCwd, "src/lib/scan-store.ts")).href)};
      import { promises as fs } from 'node:fs';
      const post = ${JSON.stringify(post())};
      await saveScan({ timestamp: new Date().toISOString(), candidates: [post] });
      if ((await latestTrends()).length !== 1) throw Error('missing saved result');
      await fs.writeFile('data/scans/collection-index.json', '{}');
      if ((await latestTrends()).length !== 1) throw Error('rebuild failed');
      await saveScan({ timestamp: new Date().toISOString(), candidates: [], verifications: [{ id: post.id, platform: post.platform, status: 'unavailable', checked_at: new Date(Date.now()+1).toISOString() }] });
      if ((await latestTrends()).length !== 0) throw Error('deleted post visible');
      if ((await readScans()).length !== 2) throw Error('history lost or index read as history');`;
    await promisify(execFile)(process.execPath, ["--import", pathToFileURL(path.join(originalCwd, "node_modules/tsx/dist/loader.mjs")).href, "--input-type=module", "-e", script], { cwd: directory });
  } finally { process.chdir(originalCwd); await fs.rm(directory, { recursive: true, force: true }); }
});

test("duplicate POST joins matching filters, rejects different filters, and polling omits unchanged snapshots", async () => {
  const { POST, GET } = await import("../src/app/api/scan/route");
  const state = globalThis as typeof globalThis & { pretrendsScanJob?: ReturnType<typeof createScanJob> };
  const original = state.pretrendsScanJob;
  const active = createScanJob(scanOptions({ mode: "prepare", platform: "Instagram", categories: ["music"] }));
  active.warnings.push("Video exceeds the 25 MB check limit.");
  state.pretrendsScanJob = active;
  try {
    const response = await POST(new Request("http://localhost/api/scan", { method: "POST", body: JSON.stringify({ categories: ["food"], platform: "TikTok" }) }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /different filters/);
    const joined = await POST(new Request("http://localhost/api/scan", { method: "POST", body: JSON.stringify({ mode: "prepare", ...active.filters }) }));
    assert.equal(joined.status, 202);
    const body = await joined.json();
    assert.equal(body.id, active.id); assert.equal(body.mode, "prepare"); assert.equal(body.joined, true);
    assert.deepEqual(body.filters, active.filters);
    const first = await (await GET(new Request(`http://localhost/api/scan?id=${active.id}`))).json();
    assert(Array.isArray(first.data.candidates));
    assert(first.warnings.includes("Video exceeds the 25 MB check limit."));
    const unchanged = await (await GET(new Request(`http://localhost/api/scan?id=${active.id}&since=${first.revision}`))).json();
    assert.equal(unchanged.data, undefined);
    const missing = await GET(new Request("http://localhost/api/scan?id=interrupted"));
    assert.equal(missing.status, 404);
  } finally { state.pretrendsScanJob = original; }
});

test("refresh batches prioritize new and rechecked posts, deduplicate and fill to twelve", async () => {
  const { selectRefreshBatch } = await import("../src/lib/refresh-batch");
  const posts = Array.from({ length: 20 }, (_, i) => ({ ...post(String(1000 + i)), score: i / 20 }));
  const batch = selectRefreshBatch([...posts, posts[0]], { categories: ["food"], platform: "all" }, ["TikTok:1000"], ["TikTok:1001"]);
  assert.equal(batch.ids.length, 12);
  assert.deepEqual(batch.ids.slice(0, 2), ["TikTok:1000", "TikTok:1001"]);
  assert.equal(new Set(batch.ids).size, 12);
  assert.equal(batch.fresh_count, 1); assert.equal(batch.reused_count, 11);
  assert.equal(selectRefreshBatch(posts.slice(0, 3), { categories: ["food"], platform: "all" }).ids.length, 3);
  assert.equal(selectRefreshBatch(posts, { categories: ["music"], platform: "all" }).ids.length, 0);
  assert.equal(selectRefreshBatch(posts, { categories: [], platform: "Instagram" }).ids.length, 0);
  assert.equal(selectRefreshBatch([{ ...posts[0], content_status: "uncertain" }], { categories: [], platform: "all" }).ids.length, 0);
  assert.equal(selectRefreshBatch([{ ...posts[0], source_verified_at: "2020-01-01" }], { categories: [], platform: "all" }).ids.length, 0);
  const combined = { ...posts[0], categories: ["food", "music"], category_evidence: [
    { ...posts[0].category_evidence![0], frames: [1] },
    { category: "music", activity: "singing", frames: [2], active: true as const, description: "A person singing." },
  ] };
  assert.equal(selectRefreshBatch([combined], { categories: ["food", "music"], platform: "all" }).ids.length, 0);
});
test("one failed platform still produces a verified batch and keeps spending limits", async () => {
  const saved = [post("999")], fresh = post("1000");
  const job = createScanJob(scanOptions({}));
  await runScan(job, {
    read: async () => [{ timestamp: saved[0].collected_at, candidates: saved }],
    latest: async () => [...saved, fresh], save: async () => undefined,
    scrape: async (platform, _topics, limit, _known, options) => {
      assert.equal(limit, 20); assert.equal(options?.maxChargeUsd, 0.25);
      if (platform === "Instagram") throw new Error("Platform temporarily unavailable");
      return { posts: [fresh], verifications: [], warnings: [], scrape_ms: 1, run_id: "mock-run" };
    },
    process: async (_posts, _progress, _checks, _deadline, options) => {
      assert.equal(options?.session?.maxNewChecks, 12);
      await options?.onResult?.(fresh); return [fresh];
    },
  });
  assert.equal(job.status, "complete");
  assert.equal(job.result?.batch.ids.length, 2);
  assert.equal(job.result?.batch.fresh_count, 1);
  assert.equal(job.result?.batch.reused_count, 1);
  assert(job.warnings.some((warning) => warning.includes("temporarily unavailable")));
});
