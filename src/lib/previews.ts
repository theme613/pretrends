import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { allowedMediaUrl, extractFrames } from "./video-frames";

import os from "node:os";

type PreviewPost = { platform: string; id: string; caption?: string; title: string; image?: string; video_url?: string; duration_seconds?: number; published_at?: string };
const directory = process.env.VERCEL
  ? path.join(os.tmpdir(), "pretrends-previews")
  : path.join(process.cwd(), "data", "previews");
export function previewKey(post: PreviewPost) {
  return createHash("sha256").update(JSON.stringify([post.platform, post.id, post.caption || post.title, post.duration_seconds ?? null, post.published_at ?? null])).digest("hex");
}
function previewPath(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid preview key.");
  return path.join(directory, `${key}.jpg`);
}
export async function readPreview(key: string) {
  try { return await fs.readFile(previewPath(key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function savePreview(key: string, frame: string) {
  if (!frame.startsWith("data:image/jpeg;base64,")) throw new Error("Invalid preview frame.");
  const bytes = Buffer.from(frame.slice(23), "base64");
  if (bytes.length < 3 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid preview image.");
  const destination = previewPath(key);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, destination); }
  finally { await fs.rm(temporary, { force: true }); }
  return key;
}
// Share work across cards, the popup, route bundles and development reloads.
const globalState = globalThis as typeof globalThis & { trendPreviews?: { active: number; pending: Map<string, Promise<Buffer>>; failed: Map<string, number> } };
const state = globalState.trendPreviews ||= { active: 0, pending: new Map(), failed: new Map() };
async function thumbnail(url: string, signal: AbortSignal) {
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!allowedMediaUrl(url)) throw new Error("Unsupported thumbnail host.");
    const response = await fetch(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new Error("Missing thumbnail redirect.");
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("image/jpeg")) {
      await response.body?.cancel(); throw new Error("Thumbnail unavailable.");
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 2 * 1024 * 1024) throw new Error("Thumbnail too large."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = Buffer.concat(chunks);
    if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid thumbnail.");
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  }
  throw new Error("Too many redirects.");
}
export async function repairPreview(post: PreviewPost): Promise<Buffer> {
  const key = previewKey(post), cached = await readPreview(key);
  if (cached) return cached;
  const pending = state.pending.get(key); if (pending) return pending;
  if (state.active >= 3 || (state.failed.get(key) || 0) > Date.now()) throw new Error("Preview busy. Try again shortly.");
  state.active++;
  const work = Promise.resolve().then(async () => {
    try {
      let frame: string | undefined;
      if (post.image) { try { frame = await thumbnail(post.image, AbortSignal.timeout(8000)); } catch { /* Use the video's real frame instead. */ } }
      if (!frame && post.video_url) frame = (await extractFrames(post.video_url, AbortSignal.timeout(45000)))[0];
      if (!frame) throw new Error("No preview media available.");
      await savePreview(key, frame);
      return (await readPreview(key))!;
    } catch (error) {
      for (const [id, until] of state.failed) if (until <= Date.now()) state.failed.delete(id);
      state.failed.set(key, Date.now() + 15000); throw error;
    } finally { state.active--; state.pending.delete(key); }
  });
  state.pending.set(key, work);
  return work;
}
