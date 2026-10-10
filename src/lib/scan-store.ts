import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScrapedData, TrendCandidate } from "./agent";
import {
  isEligiblePost,
  validSourceIdentity,
  type Verification,
} from "./post-policy";
import { previewKey } from "./previews";
import { calculateForecast } from "./forecast";

const directory = path.join(process.cwd(), "data", "scans");
const indexFile = path.join(directory, "collection-index.json");
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
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const scans: Scan[] = [];
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
  return scans.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function mergeScans(scans: Scan[]): TrendCandidate[] {
  const posts = new Map<string, TrendCandidate>();
  const checks = new Map<string, Verification>();
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
    const check = checks.get(`${post.platform}:${post.id}`);
    const updated =
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
    return { ...updated, forecast: calculateForecast(updated) };
  });
}

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const operation = (storeState.pretrendsStoreWrites || Promise.resolve()).then(work);
  storeState.pretrendsStoreWrites = operation.then(() => undefined, () => undefined);
  return operation;
}
async function historySignature() {
  try { return (await fs.readdir(directory)).filter((name) => name.startsWith("scan_") && name.endsWith(".json")).sort().join("|"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
async function indexedCandidates(): Promise<TrendCandidate[]> {
  const signature = await historySignature();
  try {
    const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
    if (index.version !== 1 || index.signature !== signature || !Array.isArray(index.candidates) ||
        !index.candidates.every((post: TrendCandidate) => post && typeof post.id === "string" && typeof post.platform === "string"))
      throw new Error("Collection index needs rebuilding.");
    return index.candidates;
  } catch {
    const candidates = mergeScans(await readScans());
    await writeIndex(candidates);
    return candidates;
  }
}
export function latestTrends(): Promise<TrendCandidate[]> {
  return serialized(async () => (await indexedCandidates()).filter((post) => isEligiblePost(post)).map((post) => ({ ...post, preview_key: previewKey(post) })));
}
async function writeIndex(candidates: TrendCandidate[]) {
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${indexFile}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ version: 1, signature: await historySignature(), candidates }));
  await fs.rename(temporary, indexFile);
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
    const current = await indexedCandidates();
    const filename = path.join(directory, `scan_${Date.now()}_${randomUUID()}.json`);
    await fs.writeFile(`${filename}.tmp`, JSON.stringify(scan));
    await fs.rename(`${filename}.tmp`, filename);
    await writeIndex(mergeScans([scan, { timestamp: "1970-01-01", candidates: current }]));
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
