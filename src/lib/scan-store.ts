import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScrapedData, TrendCandidate } from "./agent";
import {
  isEligiblePost,
  validSourceIdentity,
  type Verification,
} from "./post-policy";
import { calculateForecast } from "./forecast";

const directory = path.join(process.cwd(), "data", "scans");
export type Scan = {
  timestamp: string;
  candidates: TrendCandidate[];
  verifications?: Verification[];
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
  for (const name of names.filter((name) => name.endsWith(".json"))) {
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

export async function latestTrends(): Promise<TrendCandidate[]> {
  return mergeScans(await readScans()).filter((post) => isEligiblePost(post));
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
  return scans
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
    .sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at))[0];
}

export async function saveScan(scan: Scan) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(
    directory,
    `scan_${Date.now()}_${randomUUID()}.json`,
  );
  await fs.writeFile(`${filename}.tmp`, JSON.stringify(scan, null, 2));
  await fs.rename(`${filename}.tmp`, filename);
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
