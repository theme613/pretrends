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

const directory = path.join(process.cwd(), "data", "scans");
const writableDirectory = process.env.VERCEL
  ? path.join(os.tmpdir(), "pretrends-scans")
  : directory;
const indexFile = path.join(directory, "collection-index.json");
const writableIndexFile = path.join(writableDirectory, "collection-index.json");
// Share the queue across route bundles and development reloads in this process.
const storeState = globalThis as typeof globalThis & { pretrendsStoreWrites?: Promise<void> };
export type Scan = {
  timestamp: string;
  candidates: TrendCandidate[];
  verifications?: Verification[];
  job_id?: string;
  mode?: "refresh" | "prepare";
  metrics?: object;
};

export async function readScans(): Promise<Scan[]> {
  const scans: Scan[] = [];
  try {
    const names = await fs.readdir(directory);
    for (const name of names.filter((name) => name.startsWith("scan_") && name.endsWith(".json"))) {
      try {
        const data = JSON.parse(
          await fs.readFile(path.join(directory, name), "utf8"),
        );
        if (typeof data.timestamp === "string" && Array.isArray(data.candidates))
          scans.push(data);
      } catch {
        /* Ignore incomplete old scan files. */
      }
    }
  } catch {
    /* Directory may not exist */
  }
  if (writableDirectory !== directory) {
    try {
      const names = await fs.readdir(writableDirectory);
      for (const name of names.filter((name) => name.startsWith("scan_") && name.endsWith(".json"))) {
        try {
          const data = JSON.parse(
            await fs.readFile(path.join(writableDirectory, name), "utf8"),
          );
          if (typeof data.timestamp === "string" && Array.isArray(data.candidates))
            scans.push(data);
        } catch {
          /* Ignore incomplete old scan files. */
        }
      }
    } catch {
      /* Directory may not exist yet */
    }
  }
  return scans.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
      if (!posts.has(key)) posts.set(key, post);

      if (!postObservations.has(key)) {
        postObservations.set(key, new Map());
      }
      const obsMap = postObservations.get(key)!;
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

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const operation = (storeState.pretrendsStoreWrites || Promise.resolve()).then(work);
  storeState.pretrendsStoreWrites = operation.then(() => undefined, () => undefined);
  return operation;
}
async function historySignature() {
  const names: string[] = [];
  try {
    const entries = (await fs.readdir(directory)).filter((name) => name.startsWith("scan_") && name.endsWith(".json"));
    names.push(...entries);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (writableDirectory !== directory) {
    try {
      const entries = (await fs.readdir(writableDirectory)).filter((name) => name.startsWith("scan_") && name.endsWith(".json"));
      names.push(...entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...new Set(names)].sort().join("|");
}
async function syncBlob(pathname: string, data: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(pathname, data, { access: "public", addRandomSuffix: false, allowOverwrite: true });
  } catch (error) {
    console.error("Vercel Blob sync error:", error);
  }
}
async function fetchBlob(pathname: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { head, list } = await import("@vercel/blob");
    try {
      const h = await head(pathname);
      if (h?.url) {
        const res = await fetch(h.url, { cache: "no-store" });
        if (res.ok) return await res.text();
      }
    } catch {
      /* head might fail if not found yet */
    }
    const { blobs } = await list({ prefix: pathname });
    if (!blobs.length) return null;
    const sorted = blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    const match = sorted.find((b) => b.pathname === pathname || b.pathname.endsWith(pathname)) || sorted[0];
    if (!match) return null;
    const res = await fetch(match.url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch (error) {
    console.error("fetchBlob error:", error);
    return null;
  }
}

async function indexedCandidates(): Promise<TrendCandidate[]> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blobText = await fetchBlob("scans/collection-index.json");
      if (blobText) {
        const index = JSON.parse(blobText);
        if (index.version === 1 && Array.isArray(index.candidates) &&
            index.candidates.every((post: TrendCandidate) => post && typeof post.id === "string" && typeof post.platform === "string")) {
          await fs.mkdir(writableDirectory, { recursive: true }).catch(() => {});
          await fs.writeFile(writableIndexFile, blobText).catch(() => {});
          return index.candidates;
        }
      }
    } catch {
      /* ignore */
    }
  }
  const signature = await historySignature();
  if (writableDirectory !== directory) {
    try {
      const index = JSON.parse(await fs.readFile(writableIndexFile, "utf8"));
      if (index.version === 1 && Array.isArray(index.candidates) &&
          index.candidates.every((post: TrendCandidate) => post && typeof post.id === "string" && typeof post.platform === "string") &&
          index.candidates.length > 0)
        return index.candidates;
    } catch {
      /* ignore */
    }
  }
  try {
    const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
    if (index.version === 1 && (!signature || index.signature === signature) && Array.isArray(index.candidates) &&
        index.candidates.every((post: TrendCandidate) => post && typeof post.id === "string" && typeof post.platform === "string")) {
      if (process.env.BLOB_READ_WRITE_TOKEN && index.candidates.length > 0) {
        await syncBlob("scans/collection-index.json", JSON.stringify(index)).catch(() => {});
      }
      return index.candidates;
    }
  } catch {
    const candidates = mergeScans(await readScans());
    try {
      await writeIndex(candidates);
    } catch {
      /* ignore write failure in read-only environment */
    }
    return candidates;
  }
  const candidates = mergeScans(await readScans());
  try {
    await writeIndex(candidates);
  } catch {
    /* ignore write failure in read-only environment */
  }
  return candidates;
}
export function latestTrends(): Promise<TrendCandidate[]> {
  return serialized(async () => (await indexedCandidates()).filter((post) => isEligiblePost(post)).map((post) => ({ ...post, preview_key: previewKey(post) })));
}
async function writeIndex(candidates: TrendCandidate[]) {
  try {
    await fs.mkdir(writableDirectory, { recursive: true });
    const content = JSON.stringify({ version: 1, signature: await historySignature(), candidates });
    const temporary = `${writableIndexFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, writableIndexFile);
    await syncBlob("scans/collection-index.json", content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EROFS") {
      return;
    }
    throw error;
  }
}

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

export function saveScan(scan: Scan) {
  return serialized(async () => {
    try {
      const current = await indexedCandidates();
      await fs.mkdir(writableDirectory, { recursive: true });
      const scanName = `scan_${Date.now()}_${randomUUID()}.json`;
      const filename = path.join(writableDirectory, scanName);
      const json = JSON.stringify(scan);
      await fs.writeFile(`${filename}.tmp`, json);
      await fs.rename(`${filename}.tmp`, filename);
      await syncBlob(`scans/${scanName}`, json);
      await writeIndex(mergeScans([scan, { timestamp: "1970-01-01", candidates: current }]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EROFS") {
        return;
      }
      throw error;
    }
  });
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
