import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { previewKey, readPreview, repairPreview, savePreview } from "../src/lib/previews";

const bytes = Buffer.from([255, 216, 255, 217]);
const frame = `data:image/jpeg;base64,${bytes.toString("base64")}`;
const post = () => ({ id: randomUUID(), platform: "TikTok", title: "Test preview", image: "https://p16.tiktokcdn.com/test.jpg" });
const remove = (key: string) => fs.rm(path.join(process.cwd(), "data/previews", `${key}.jpg`), { force: true });

test("saved frames survive reads and metric changes without remote requests", async () => {
  const source = post(), key = previewKey(source);
  try {
    await savePreview(key, frame);
    assert.deepEqual(await readPreview(key), bytes);
    assert.deepEqual(await repairPreview({ ...source, image: "https://expired.invalid/photo" }), bytes);
    assert.equal(previewKey({ ...source, image: "https://new.example/photo" }), key);
    assert.notEqual(previewKey({ ...source, caption: "Changed content" }), key);
  } finally { await remove(key); }
});
test("preview storage rejects invalid paths and non-JPEG data", async () => {
  await assert.rejects(readPreview("../secrets"));
  await assert.rejects(savePreview("a".repeat(64), "data:image/jpeg;base64,YmFk"));
});
test("legacy preview recovery deduplicates work, caches images and blocks unsafe redirects", async () => {
  const original = globalThis.fetch;
  const source = post(), unsafe = post();
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; await new Promise((resolve) => setTimeout(resolve, 10)); return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }); };
    const result = await Promise.all([repairPreview(source), repairPreview(source)]);
    assert.equal(requests, 1); assert.deepEqual(result[0], bytes);
    await repairPreview(source); assert.equal(requests, 1);
    globalThis.fetch = async () => { requests++; return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }); };
    await assert.rejects(repairPreview(unsafe));
    assert.equal(requests, 2);
    await assert.rejects(repairPreview(unsafe)); // Failure cooldown avoids repeated downloads.
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; await remove(previewKey(source)); }
});
test("preview repairs are limited to three downloads and reject oversized images", async () => {
  const original = globalThis.fetch, sources = [post(), post(), post()];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    let started = 0;
    globalThis.fetch = async () => { started++; await gate; return new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/jpeg" } }); };
    const work = sources.map((source) => repairPreview(source).catch(() => null));
    while (started < 3) await new Promise((resolve) => setTimeout(resolve, 1));
    await assert.rejects(repairPreview(post()), /busy/);
    release(); await Promise.all(work);
    for (const source of sources) assert.equal(await readPreview(previewKey(source)), null);
  } finally { release(); globalThis.fetch = original; }
});
