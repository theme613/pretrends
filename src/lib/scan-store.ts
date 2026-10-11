import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScrapedData, TrendCandidate } from "./agent";
import {
  isEligiblePost,
  validSourceIdentity,
  type Verification,
} from "./post-policy";
import os from "node:os";
import { previewKey } from "./previews";
import { calculateForecast } from "./forecast";
import { configuredBlobStore, type BlobStore } from "./blob-store";

export type Scan = {
  timestamp: string;
  candidates: TrendCandidate[];
  verifications?: Verification[];
  job_id?: string;
  mode?: "refresh" | "prepare";
  metrics?: object;
};

function mergeCandidate(first: TrendCandidate, second: TrendCandidate): TrendCandidate {
  const time = (value?: string) => Date.parse(value || "") || 0;
  const observation = time(first.collected_at) >= time(second.collected_at) ? first : second;
  const source = time(first.source_verified_at) >= time(second.source_verified_at) ? first : second;
  // A pending raw observation can reuse evidence for unchanged content. An
  // actual newer failed/uncertain check must never revive older success.
  const matching = [first, second].filter((post) => previewKey(post) === previewKey(observation));
  const checked = matching.sort((a, b) =>
    time(b.content_checked_at || (b.content_status === "verified" ? b.collected_at : undefined)) -
    time(a.content_checked_at || (a.content_status === "verified" ? a.collected_at : undefined)))[0];
  const { id, title, creator, platform, url, caption, short_code, video_url,
    duration_seconds, published_at, image, views_t0, views_t1, collected_at,
    baseline_at, has_baseline, snapshots } = observation;
  return { ...checked, id, title, creator, platform, url, caption, short_code, video_url,
    duration_seconds, published_at, image, views_t0, views_t1, collected_at,
    baseline_at, has_baseline, snapshots,
    source_status: source.source_status, source_verified_at: source.source_verified_at,
    source_run_id: source.source_run_id };
}

export function mergeScans(scans: Scan[]): TrendCandidate[] {
  const posts = new Map<string, TrendCandidate>();
  const checks = new Map<string, Verification>();
  const postObservations = new Map<string, Map<string, number>>();

  for (const scan of [...scans].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  )) {
    for (const post of scan.candidates) {
      if (
        !post ||
        typeof post.id !== "string" ||
        typeof post.platform !== "string"
      )
        continue;
      const key = `${post.platform}:${post.id}`;
      const existing = posts.get(key);
      if (!existing) {
        posts.set(key, post);
      } else posts.set(key, mergeCandidate(existing, post));

      if (!postObservations.has(key)) {
        postObservations.set(key, new Map());
      }
      const obsMap = postObservations.get(key)!;
      for (const snapshot of post.snapshots || []) {
        if (Number.isFinite(Date.parse(snapshot.timestamp)) && Number.isSafeInteger(snapshot.views) && snapshot.views >= 0)
          obsMap.set(snapshot.timestamp, snapshot.views);
      }
      if (
        post.has_baseline &&
        post.baseline_at &&
        Number.isSafeInteger(post.views_t0) &&
        post.views_t0 !== null &&
        post.views_t0 >= 0
      ) {
        obsMap.set(post.baseline_at, post.views_t0);
      }
      if (
        post.collected_at &&
        Number.isSafeInteger(post.views_t1) &&
        post.views_t1 >= 0
      ) {
        obsMap.set(post.collected_at, post.views_t1);
      }
    }
    for (const check of scan.verifications || []) {
      const key = `${check.platform}:${check.id}`;
      if (
        !checks.has(key) ||
        Date.parse(check.checked_at) > Date.parse(checks.get(key)!.checked_at)
      )
        checks.set(key, check);
    }
  }

  return [...posts.values()].map((post) => {
    const key = `${post.platform}:${post.id}`;
    const check = checks.get(key);
    let updated =
      check &&
      Date.parse(check.checked_at) >=
        Date.parse(post.source_verified_at || "1970-01-01")
        ? {
            ...post,
            source_status: check.status,
            source_verified_at: check.checked_at,
            source_run_id: check.run_id,
          }
        : post;

    const obsMap = postObservations.get(key);
    const snapshots: Array<{ views: number; timestamp: string }> = [];
    if (obsMap) {
      for (const [timestamp, views] of obsMap.entries()) {
        if (Number.isFinite(Date.parse(timestamp))) {
          snapshots.push({ timestamp, views });
        }
      }
      snapshots.sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
      );
    }

    if (snapshots.length >= 2) {
      const earliest = snapshots[0];
      const latest = snapshots[snapshots.length - 1];
      const hours_between =
        (Date.parse(latest.timestamp) - Date.parse(earliest.timestamp)) /
        3600000;
      if (hours_between > 0) {
        const hourly_growth_rate =
          (latest.views - earliest.views) / hours_between;
        const projected_total = Math.max(
          0,
          Math.round(latest.views + hourly_growth_rate * 72),
        );
        updated = {
          ...updated,
          views_t0: earliest.views,
          views_t1: latest.views,
          baseline_at: earliest.timestamp,
          collected_at: latest.timestamp,
          has_baseline: true,
          snapshots,
          hourly_growth_rate,
          hours_between,
          forecast: {
            method: "linear-72h-v1",
            status: "ready",
            estimated_total: projected_total,
            views_per_hour: hourly_growth_rate,
            calculated_at: latest.timestamp,
            target_at: new Date(
              Date.parse(latest.timestamp) + 72 * 3600000,
            ).toISOString(),
          },
        };
        return updated;
      }
    }

    const singleSnapshots =
      snapshots.length > 0
        ? snapshots
        : [{ views: updated.views_t1, timestamp: updated.collected_at }];
    updated = {
      ...updated,
      has_baseline: false,
      snapshots: singleSnapshots,
      hourly_growth_rate: null,
      hours_between: null,
      forecast: calculateForecast(updated),
    };
    return updated;
  });
}

// Every cloud scan has a unique name. Immutable history is authoritative;
// an overwritten collection index can be stale and loses concurrent updates.
export function createScanStore(options: {
  directory: string;
  writableDirectory?: string;
  cloud?: BlobStore;
}) {
  const directory = options.directory;
  const writableDirectory = options.writableDirectory || directory;
  const cloud = options.cloud;
  const remoteScans = new Map<string, Scan>();
  let legacyIndex: Scan | undefined;
  let writer: Promise<void> = Promise.resolve();

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const operation = writer.then(work);
    writer = operation.then(() => undefined, () => undefined);
    return operation;
  }
  function validScan(value: unknown): value is Scan {
    if (!value || typeof value !== "object") return false;
    const scan = value as Scan;
    return typeof scan.timestamp === "string" && Array.isArray(scan.candidates) &&
      scan.candidates.every((post) => post && typeof post.id === "string" && typeof post.platform === "string");
  }
  function parseIndex(text: string): Scan | undefined {
    const index = JSON.parse(text);
    const scan = { timestamp: "1970-01-01", candidates: index.candidates };
    return index.version === 1 && validScan(scan) ? scan : undefined;
  }
  async function localHistory() {
    const scans = new Map<string, Scan>();
    for (const folder of new Set([directory, writableDirectory])) {
      let names: string[];
      try { names = await fs.readdir(folder); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const name of names.filter((entry) => /^scan_.*\.json$/.test(entry))) {
        try {
          const scan = JSON.parse(await fs.readFile(path.join(folder, name), "utf8"));
          if (validScan(scan)) scans.set(name, scan);
        } catch { /* Incomplete legacy files are not valid observations. */ }
      }
    }
    return scans;
  }
  async function history(signal = AbortSignal.timeout(25000)): Promise<Scan[]> {
    const local = await localHistory();
    let seed: Scan | undefined;
    try { seed = parseIndex(await fs.readFile(path.join(directory, "collection-index.json"), "utf8")); }
    catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (cloud) {
      const names = await cloud.list("scans/", signal);
      const missing = names.filter((name) => /^scans\/scan_.*\.json$/.test(name) && !remoteScans.has(name));
      let next = 0;
      // Download each immutable file once per instance, with bounded concurrency.
      await Promise.all(Array.from({ length: Math.min(6, missing.length) }, async () => {
        while (next < missing.length) {
          const name = missing[next++];
          const bytes = await cloud.read(name, signal);
          if (!bytes) throw new Error("A saved cloud scan could not be read. Try again.");
          const scan = JSON.parse(bytes.toString("utf8"));
          if (!validScan(scan)) throw new Error("A saved cloud scan is invalid.");
          remoteScans.set(name, scan);
        }
      }));
      // Recover data written before immutable history became authoritative.
      // Never upload a bundled seed as a side effect of reading the page.
      if (!legacyIndex && names.includes("scans/collection-index.json")) {
        const bytes = await cloud.read("scans/collection-index.json", signal);
        if (!bytes || !(legacyIndex = parseIndex(bytes.toString("utf8"))))
          throw new Error("The saved cloud collection could not be read.");
      }
      for (const [name, scan] of remoteScans) local.set(name.slice("scans/".length), scan);
    }
    const scans = [...local.values()];
    if (legacyIndex) scans.push(legacyIndex);
    if (seed) {
      // In local mode the index also acts as a recovery seed. Avoid counting a
      // derived index twice when all of its posts already have local history.
      const known = new Set(scans.flatMap((scan) => scan.candidates.map((post) => `${post.platform}:${post.id}`)));
      const candidates = writableDirectory !== directory || cloud
        ? seed.candidates
        : seed.candidates.filter((post) => !known.has(`${post.platform}:${post.id}`));
      if (candidates.length) scans.push({ ...seed, candidates });
    }
    return scans.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  async function writeLocal(scan: Scan, name: string) {
    await fs.mkdir(writableDirectory, { recursive: true });
    const filename = path.join(writableDirectory, name);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(scan));
      await fs.rename(temporary, filename);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return {
    readScans: (signal?: AbortSignal) => serialized(() => history(signal)),
    latestTrends: (signal?: AbortSignal): Promise<TrendCandidate[]> => serialized(async () => mergeScans(await history(signal))
      .filter((post) => isEligiblePost(post))
      .map((post) => ({ ...post, preview_key: previewKey(post) }))),
    saveScan: (scan: Scan, signal?: AbortSignal) => serialized(async () => {
      const name = `scan_${Date.now()}_${randomUUID()}.json`;
      if (cloud) {
        // Only report a successful save after shared durable storage accepts it.
        // There is no read/modify/write race between separate server instances.
        await cloud.write(`scans/${name}`, JSON.stringify(scan), signal);
        remoteScans.set(`scans/${name}`, scan);
        await writeLocal(scan, name).catch(() => undefined); // Optional warm cache.
        return;
      }
      // Capture bundled-only posts before rebuilding the local index.
      const current = await history(signal);
      await writeLocal(scan, name);
      const candidates = mergeScans([scan, ...current]);
      const index = path.join(writableDirectory, "collection-index.json");
      const temporary = `${index}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, candidates }));
        await fs.rename(temporary, index);
      } finally { await fs.rm(temporary, { force: true }); }
    }),
  };
}

const directory = path.join(process.cwd(), "data", "scans");
const state = globalThis as typeof globalThis & { pretrendsScanStore?: ReturnType<typeof createScanStore> };
const store = state.pretrendsScanStore ||= createScanStore({
  directory,
  writableDirectory: process.env.VERCEL ? path.join(os.tmpdir(), "pretrends-scans") : directory,
  cloud: configuredBlobStore(),
});
export const readScans = store.readScans;
export const latestTrends = store.latestTrends;
export const saveScan = store.saveScan;

function sameSourceObservation(candidate: TrendCandidate, post: ScrapedData) {
  try {
    const previousUrl = new URL(candidate.url);
    const currentUrl = new URL(post.url);
    const previousCode = previousUrl.pathname.match(
      /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/,
    )?.[1];
    const currentCode = currentUrl.pathname.match(
      /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/,
    )?.[1];
    return (
      validSourceIdentity(
        candidate.platform,
        candidate.id,
        candidate.url,
        candidate.short_code || previousCode,
      ) &&
      (candidate.platform === "Instagram"
        ? previousCode === currentCode
        : previousUrl.pathname.replace(/\/$/, "") ===
          currentUrl.pathname.replace(/\/$/, ""))
    );
  } catch {
    return false;
  }
}

// Only successful metric observations may become the earlier count. Keep legacy real observations.
export function previousObservation(
  scans: Scan[],
  post: ScrapedData,
): TrendCandidate | undefined {
  const observations = scans
    .flatMap((scan) => scan.candidates)
    .filter(
      (candidate) =>
        candidate.platform === post.platform &&
        candidate.id === post.id &&
        sameSourceObservation(candidate, post) &&
        Number.isSafeInteger(candidate.views_t1) &&
        candidate.views_t1 >= 0 &&
        Number.isFinite(Date.parse(candidate.collected_at)) &&
        Date.parse(candidate.collected_at) < Date.parse(post.collected_at),
    )
    .sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at));
  // Prefer a useful interval; retain the latest observation when no hour-old one exists.
  // A recent decrease must not be hidden by selecting an older, smaller count.
  if (observations[0]?.views_t1 > post.views_t1) return observations[0];
  return observations.find((candidate) => Date.parse(post.collected_at) - Date.parse(candidate.collected_at) >= 3600000) || observations[0];
}

export function compareObservation(
  post: ScrapedData,
  previous?: TrendCandidate,
): ScrapedData {
  return {
    ...post,
    views_t0: previous?.views_t1 ?? post.views_t1,
    baseline_at: previous?.collected_at,
    has_baseline: Boolean(previous),
  };
}
