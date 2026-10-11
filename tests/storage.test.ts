import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentCheckKey, contentChecksFromHistory, contentFingerprint, fallback, type TrendCandidate } from "../src/lib/agent";
import { configuredBlobStore, type BlobStore } from "../src/lib/blob-store";
import { CONTENT_CHECK_VERSION } from "../src/lib/post-policy";
import { createScanStore, mergeScans, previousObservation, type Scan } from "../src/lib/scan-store";

function post(id: string, time = new Date().toISOString()): TrendCandidate {
  const value: TrendCandidate = {
    ...fallback({ id, platform: "TikTok", title: "Stirring soup", creator: "chef",
      url: `https://www.tiktok.com/@chef/video/${id}`, views_t0: null, views_t1: 120,
      collected_at: time, source_status: "available", source_verified_at: time, source_run_id: "run" }),
    categories: ["food"], category_evidence: [{ category: "food", activity: "cooking_food", frames: [1], active: true, description: "Hands stirring soup." }],
    content_status: "verified", content_check_version: CONTENT_CHECK_VERSION,
    content_checked_at: time, ai_status: "complete",
  };
  value.content_fingerprint = contentFingerprint(value);
  return value;
}
function memoryCloud() {
  const files = new Map<string, string>();
  const reads: string[] = [], writes: string[] = [];
  let listings = 0;
  const cloud: BlobStore = {
    async list(prefix) { listings++; return [...files.keys()].filter((name) => name.startsWith(prefix)); },
    async read(name) { reads.push(name); const value = files.get(name); return value === undefined ? null : Buffer.from(value); },
    async write(name, value, _signal, overwrite) {
      assert.equal(overwrite, undefined, "Scan history must remain immutable");
      assert(!files.has(name), "Independent writers must use different names");
      writes.push(name); files.set(name, String(value));
    },
  };
  return { cloud, files, reads, writes, listings: () => listings };
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pretrends-storage-"));
  try { await run(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test("cold deployment loads bundled index into history for evidence and baseline reuse without cloud writes", async () => temporary(async (directory) => {
  const old = post("1", new Date(Date.now() - 7200000).toISOString());
  await fs.writeFile(path.join(directory, "collection-index.json"), JSON.stringify({ version: 1, candidates: [old] }));
  const memory = memoryCloud();
  const store = createScanStore({ directory, writableDirectory: path.join(directory, "cache"), cloud: memory.cloud });
  const scans = await store.readScans();
  assert.equal(scans.length, 1);
  assert.equal(contentChecksFromHistory(scans).get(contentCheckKey(old))?.content_status, "verified");
  assert.equal(previousObservation(scans, { ...old, collected_at: new Date().toISOString() })?.views_t1, 120);
  assert.equal((await store.latestTrends()).length, 1);
  assert.equal(memory.writes.length, 0);
}));

test("independent cloud writers retain every result across cold starts despite a stale legacy index", async () => temporary(async (directory) => {
  const memory = memoryCloud();
  const seed = JSON.stringify({ version: 1, candidates: [post("1")] });
  memory.files.set("scans/collection-index.json", seed);
  const first = createScanStore({ directory, writableDirectory: path.join(directory, "first"), cloud: memory.cloud });
  const second = createScanStore({ directory, writableDirectory: path.join(directory, "second"), cloud: memory.cloud });
  await Promise.all([
    first.saveScan({ timestamp: new Date().toISOString(), candidates: [post("2")] }),
    second.saveScan({ timestamp: new Date().toISOString(), candidates: [post("3")] }),
  ]);
  await first.saveScan({ timestamp: new Date().toISOString(), candidates: [post("4")] });
  assert.equal(memory.files.get("scans/collection-index.json"), seed);
  const cold = createScanStore({ directory: path.join(directory, "empty"), cloud: memory.cloud });
  assert.deepEqual((await cold.latestTrends()).map((entry) => entry.id).sort(), ["1", "2", "3", "4"]);
  const downloaded = memory.reads.length;
  const listed = memory.listings();
  await cold.latestTrends();
  assert.equal(memory.reads.length, downloaded, "Immutable history is downloaded only once per instance");
  assert.equal(memory.listings(), listed + 1, "Every read checks for new files from other instances");
  await second.saveScan({ timestamp: new Date().toISOString(), candidates: [post("5")] });
  assert.equal((await cold.latestTrends()).length, 5);
  assert.equal(memory.reads.length, downloaded + 1);
}));

test("a temporarily incomplete listing does not forget this instance's durable writes", async () => temporary(async (directory) => {
  const memory = memoryCloud();
  const store = createScanStore({ directory, cloud: { ...memory.cloud, list: async () => [] } });
  await store.saveScan({ timestamp: new Date().toISOString(), candidates: [post("1")] });
  assert.equal((await store.latestTrends()).length, 1);
}));

test("cloud save and read failures stay visible and never become successful ephemeral saves", async () => temporary(async (directory) => {
  const memory = memoryCloud();
  const store = createScanStore({ directory, cloud: {
    ...memory.cloud, write: async () => { throw new Error("cloud write rejected"); },
  } });
  await assert.rejects(store.saveScan({ timestamp: new Date().toISOString(), candidates: [post("1")] }), /cloud write rejected/);
  assert.deepEqual(await fs.readdir(directory), []);
  const denied = createScanStore({ directory, cloud: { ...memory.cloud, list: async () => { throw new Error("cloud denied"); } } });
  await assert.rejects(denied.readScans(), /cloud denied/);
  await assert.rejects(denied.latestTrends(), /cloud denied/);
  const missing = createScanStore({ directory, cloud: { ...memory.cloud, list: async () => ["scans/scan_missing.json"] } });
  await assert.rejects(missing.readScans(), /could not be read/);
}));

test("merging old raw observations cannot downgrade current metrics or revive a failed visual check", () => {
  const earlier = new Date(Date.now() - 7200000).toISOString();
  const recent = new Date(Date.now() - 1000).toISOString();
  const verified = post("1", recent);
  const old = { ...fallback({ ...verified, collected_at: earlier, source_verified_at: earlier, source_status: "unverified", views_t1: 20 }), categories: [], content_checked_at: undefined };
  const scans: Scan[] = [{ timestamp: recent, candidates: [verified] }, { timestamp: earlier, candidates: [old] }];
  const result = mergeScans(scans)[0];
  assert.equal(result.views_t1, 120);
  assert.equal(result.collected_at, recent);
  assert.equal(result.source_status, "available");
  const checked = new Date().toISOString();
  const failed = { ...verified, content_status: "unavailable" as const, content_checked_at: checked, check_error: "Video failed." };
  assert.equal(mergeScans([{ timestamp: checked, candidates: [failed] }, ...scans])[0].content_status, "unavailable");
  const deleted = { id: verified.id, platform: verified.platform, checked_at: checked, status: "unavailable" as const };
  assert.equal(mergeScans([{ timestamp: checked, candidates: [], verifications: [deleted] }, ...scans])[0].source_status, "unavailable");
  const pending = { ...fallback({ ...verified, collected_at: checked, views_t1: 130 }), content_checked_at: undefined };
  const reused = mergeScans([{ timestamp: checked, candidates: [pending] }, ...scans])[0];
  assert.equal(reused.content_status, "verified");
  assert.equal(reused.views_t1, 130);
});

test("Blob adapter follows every listing page and authenticates private reads with bounded signals", async () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN, access = process.env.BLOB_ACCESS;
  process.env.BLOB_READ_WRITE_TOKEN = "test-only";
  process.env.BLOB_ACCESS = "private";
  const calls: Array<{ operation: string; options: Record<string, unknown> }> = [];
  const sdk = {
    async list(options: Record<string, unknown>) {
      calls.push({ operation: "list", options });
      return options.cursor
        ? { blobs: [{ pathname: "scans/scan_second.json" }], hasMore: false }
        : { blobs: [{ pathname: "scans/scan_first.json" }], hasMore: true, cursor: "next" };
    },
    async get(_name: string, options: Record<string, unknown>) {
      calls.push({ operation: "get", options });
      return { statusCode: 200, stream: new Response("saved content").body };
    },
    async put(_name: string, _body: unknown, options: Record<string, unknown>) { calls.push({ operation: "put", options }); },
  } as unknown as Parameters<typeof configuredBlobStore>[0];
  try {
    const cloud = configuredBlobStore(sdk)!;
    assert.deepEqual(await cloud.list("scans/"), ["scans/scan_first.json", "scans/scan_second.json"]);
    assert.equal((await cloud.read("scans/scan_first.json"))?.toString(), "saved content");
    await cloud.write("scans/scan_new.json", "{}");
    assert.equal(calls.find((call) => call.operation === "get")?.options.access, "private");
    assert.equal(calls.find((call) => call.operation === "get")?.options.useCache, false);
    assert.equal(calls.find((call) => call.operation === "put")?.options.allowOverwrite, false);
    assert(calls.every((call) => call.options.abortSignal instanceof AbortSignal));
    process.env.BLOB_ACCESS = "public";
    await configuredBlobStore(sdk)!.read("scans/scan_first.json");
    assert.equal(calls.at(-1)?.options.access, "public");
    assert.equal(calls.at(-1)?.options.useCache, undefined);
  } finally {
    if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = token;
    if (access === undefined) delete process.env.BLOB_ACCESS; else process.env.BLOB_ACCESS = access;
  }
});
