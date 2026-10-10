import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScrapedData, TrendCandidate } from "./agent";

const directory = path.join(process.cwd(), "data", "scans");
export type Scan = { timestamp: string; candidates: TrendCandidate[] };

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

export async function latestTrends(): Promise<unknown[]> {
  const scans = await readScans();
  const posts = new Map<string, TrendCandidate>();
  for (const scan of scans) {
    for (const post of scan.candidates) {
      const key = `${post.platform}:${post.id}`;
      if (!posts.has(key)) posts.set(key, post);
    }
  }
  return [...posts.values()];
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
