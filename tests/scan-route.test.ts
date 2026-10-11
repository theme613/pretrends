import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../src/app/api/scan/route";
import { createScanJob, scanOptions, type ScanJob } from "../src/lib/scan-runner";

const state = globalThis as typeof globalThis & { pretrendsScanJob?: ScanJob; pretrendsScanWork?: Promise<void> };
const request = (mode = "refresh") => new Request("http://localhost/api/scan", {
  method: "POST", body: JSON.stringify({ mode, platform: "TikTok" }),
});

test("Vercel refuses paid work when durable storage is not configured", async () => {
  const env = { ...process.env }, job = state.pretrendsScanJob;
  try {
    delete state.pretrendsScanJob;
    process.env.VERCEL = "1";
    process.env.APIFY_API_TOKEN = "test-only";
    process.env.GRAFILAB_API_KEY = "test-only";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.code, "MISSING_CONFIGURATION");
    assert.match(body.error, /BLOB_READ_WRITE_TOKEN.*Vercel/);
    assert.equal(state.pretrendsScanJob, undefined);
  } finally { process.env = env; state.pretrendsScanJob = job; }
});

test("duplicate Vercel refresh and preparation requests wait for the same result without polling another instance", async () => {
  const env = { ...process.env }, originalJob = state.pretrendsScanJob, originalWork = state.pretrendsScanWork;
  try {
    process.env.VERCEL = "1";
    for (const mode of ["refresh", "prepare"]) {
      const job = createScanJob(scanOptions({ mode, platform: "TikTok" }));
      let finish!: () => void;
      state.pretrendsScanJob = job;
      state.pretrendsScanWork = new Promise<void>((resolve) => { finish = resolve; });
      let responded = false;
      const responsePromise = POST(request(mode)).then((response) => { responded = true; return response; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(responded, false);
      job.status = "complete";
      job.result = { batch: { ids: [], fresh_count: 0, reused_count: 0 }, live_scan: true,
        scraped_count: 0, verified_count: 0, warnings: [], ai_usage: { input_tokens: 0, output_tokens: 0 },
        data: { timestamp: new Date().toISOString(), candidates: [] } };
      finish();
      const response = await responsePromise;
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.id, job.id);
      assert.equal(body.status, "complete");
      assert.deepEqual(body.data.candidates, []);
    }
  } finally { process.env = env; state.pretrendsScanJob = originalJob; state.pretrendsScanWork = originalWork; }
});

test("an expired in-memory Vercel job cannot leave refresh permanently busy", async () => {
  const env = { ...process.env }, original = state.pretrendsScanJob;
  try {
    process.env.VERCEL = "1";
    delete process.env.APIFY_API_TOKEN;
    state.pretrendsScanJob = { ...createScanJob(scanOptions({ platform: "Instagram" })),
      started_at: new Date(Date.now() - 301000).toISOString() };
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "MISSING_CONFIGURATION");
  } finally { process.env = env; state.pretrendsScanJob = original; }
});
