import { randomUUID } from "node:crypto";
import { contentCheckKey, contentChecksFromHistory, createAnalysisSession, fallback, processCandidates, type TrendCandidate } from "./agent";
import { scrape } from "./apify";
import { validSourceIdentity, type Verification, isEligiblePost } from "./post-policy";
import { compareObservation, latestTrends, mergeScans, previousObservation, readScans, saveScan } from "./scan-store";
import { selectRefreshBatch, type RefreshBatch } from "./refresh-batch";
import { hashtags } from "./scan-topics";

type Platform = "Instagram" | "TikTok";
export type ScanMode = "refresh" | "prepare";
type ScanOptions = { mode: ScanMode; filters: { categories: string[]; platform: "all" | Platform } };
export type ScanJob = ScanOptions & {
  id: string; status: "running" | "complete" | "failed"; stage: string;
  freshIds: string[]; refreshedIds: string[];
  processed: number; total: number; revision: number; snapshotSignature?: string;
  started_at: string; warnings: string[]; error?: string;
  metrics: { elapsed_ms: number; first_result_ms: number | null; scraper_ms: Partial<Record<Platform, number>>;
    download_ms: number; frame_ms: number; ai_ms: number; cache_hits: number; ai_attempts: number;
    new_checks: number; input_tokens: number; output_tokens: number };
  result?: { batch: RefreshBatch; live_scan: true; scraped_count: number; verified_count: number; warnings: string[];
    ai_usage: { input_tokens: number; output_tokens: number };
    data: { timestamp: string; candidates: TrendCandidate[] } };
};
export function scanOptions(input: unknown): ScanOptions {
  if (!input || typeof input !== "object") throw new Error("Invalid scan request.");
  const value = input as Record<string, unknown>;
  if (value.mode !== undefined && !["refresh", "prepare"].includes(String(value.mode))) throw new Error("Choose refresh or prepare mode.");
  if (value.platform !== undefined && !["all", "TikTok", "Instagram"].includes(String(value.platform))) throw new Error("Live scans support TikTok and Instagram.");
  const categories = Array.isArray(value.categories) ? [...new Set(value.categories.filter((c): c is string => typeof c === "string" && Object.hasOwn(hashtags, c)))].slice(0, 4) : [];
  return { mode: value.mode === "prepare" ? "prepare" : "refresh", filters: { categories, platform: (value.platform || "all") as ScanOptions["filters"]["platform"] } };
}
export function createScanJob(options: ScanOptions): ScanJob {
  return { ...options, freshIds: [], refreshedIds: [], id: randomUUID(), status: "running", stage: "Collecting posts…", processed: 0,
    total: 0, revision: 0, started_at: new Date().toISOString(), warnings: [],
    metrics: { elapsed_ms: 0, first_result_ms: null, scraper_ms: {}, download_ms: 0, frame_ms: 0,
      ai_ms: 0, cache_hits: 0, ai_attempts: 0, new_checks: 0, input_tokens: 0, output_tokens: 0 } };
}

// Injectable IO lets tests prove progressive publishing without paid services.
type Dependencies = { scrape: typeof scrape; process: typeof processCandidates; read: typeof readScans;
  save: typeof saveScan; latest: typeof latestTrends };
export async function runScan(job: ScanJob, overrides: Partial<Dependencies> = {}) {
  const io: Dependencies = { scrape, process: processCandidates, read: readScans, save: saveScan, latest: latestTrends, ...overrides };
  const started = Date.parse(job.started_at), deadline = started + 14 * 60000;
  const session = createAnalysisSession(job.mode === "refresh" ? 12 : 250, job.mode === "refresh" ? 15 : 300);
  let writer: Promise<void> = Promise.resolve();
  const completed: TrendCandidate[] = [], seen = new Set<string>();
  let scrapedCount = 0;
  const publish = (candidates: TrendCandidate[], verifications: Verification[] = []) => {
    const saved = writer.then(async () => {
      await io.save({ timestamp: new Date().toISOString(), candidates, verifications });
      job.revision++;
      if (job.metrics.first_result_ms === null && candidates.some((post) => isEligiblePost(post)))
        job.metrics.first_result_ms = Date.now() - started;
    });
    writer = saved;
    return saved;
  };
  const updateMetrics = () => Object.assign(job.metrics, { elapsed_ms: Date.now() - started,
    cache_hits: session.cacheHits, ai_attempts: session.attempts, new_checks: session.newChecks,
    input_tokens: session.inputTokens, output_tokens: session.outputTokens });
  try {
    const scans = await io.read(), stored = mergeScans(scans), checks = contentChecksFromHistory(scans);
    const knownIds = new Set(stored.map((post) => `${post.platform}:${post.id}`));
    const selected = job.filters.categories;
    const topics = selected.length ? [...new Set(selected.flatMap((category) =>
      hashtags[category].slice(0, job.mode === "refresh" ? 1 : Math.floor(20 / selected.length))))].slice(0, 20)
      : Object.values(hashtags).map((tags) => tags[0]);
    const platforms: Platform[] = job.filters.platform === "all" ? ["Instagram", "TikTok"] : [job.filters.platform];
    const tasks = platforms.map(async (platform) => {
      const known = stored.filter((post) => {
        if (post.platform !== platform || (selected.length && !selected.every((category) => post.categories.includes(category)))) return false;
        let code = post.short_code;
        try { code ||= new URL(post.url).pathname.match(/^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/)?.[1]; } catch { return false; }
        return validSourceIdentity(post.platform, post.id, post.url, code);
      }).sort((a, b) => Date.parse(a.source_verified_at || "1970-01-01") - Date.parse(b.source_verified_at || "1970-01-01"))
        .slice(0, job.mode === "refresh" ? 5 : 100);
      let result: Awaited<ReturnType<typeof scrape>>;
      try {
        result = await io.scrape(platform, topics, job.mode === "refresh" ? 20 : 300, known,
          { maxChargeUsd: job.mode === "refresh" ? 0.25 : 1 });
      } catch (error) {
        job.warnings.push(error instanceof Error ? error.message : `${platform} could not be scanned.`);
        await publish([], known.map((post) => ({ id: post.id, platform, status: "unverified", checked_at: new Date().toISOString() })));
        return;
      }
      job.metrics.scraper_ms[platform] = result.scrape_ms;
      job.warnings.push(...result.warnings);
      const observations = result.posts.filter((post) => {
        const key = `${post.platform}:${post.id}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).map((post) => compareObservation(post, previousObservation(scans, post)));
      scrapedCount += observations.length;
      job.total += observations.length;
      // Save raw observations/failures immediately, before expensive checks.
      await publish(observations.map((post) => {
        const cached = checks.get(contentCheckKey(post));
        return cached?.content_status === "verified"
          ? { ...cached, ...post, forecast: fallback(post).forecast, velocity: fallback(post).velocity, ai_usage: undefined, timings: undefined }
          : fallback(post, "Waiting for a visual check.");
      }), result.verifications);
      job.stage = "Checking video content";
      await io.process(observations, undefined, checks, deadline - 90000, {
        session,
        onResult: async (post) => {
          await publish([post]);
          completed.push(post);
          if (isEligiblePost(post)) {
            const id = `${post.platform}:${post.id}`;
            const ids = knownIds.has(id) ? job.refreshedIds : job.freshIds;
            if (!ids.includes(id)) ids.push(id);
          }
          job.processed++;
          job.metrics.download_ms += post.timings?.download_ms || 0;
          job.metrics.frame_ms += post.timings?.frame_ms || 0;
          job.metrics.ai_ms += post.timings?.ai_ms || 0;
          updateMetrics();
        },
      });
    });
    // Each task publishes independently; this wait is only for final completion.
    const settled = await Promise.allSettled(tasks);
    await writer;
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    updateMetrics();
    if (session.stopped) job.warnings.push(session.stopped);
    const failures = [...new Set(completed.filter((post) => post.content_status !== "verified").map((post) => post.check_error).filter(Boolean))];
    job.warnings.push(...failures.slice(0, 3) as string[]);
    if (!scrapedCount) throw new Error(job.warnings.join(" ") || "No verifiable posts were found.");
    const eligible = await io.latest();
    job.result = { batch: selectRefreshBatch(eligible, job.filters, job.freshIds, job.refreshedIds), live_scan: true, scraped_count: scrapedCount,
      verified_count: completed.filter((post) => isEligiblePost(post)).length,
      warnings: [...new Set(job.warnings)], ai_usage: { input_tokens: session.inputTokens, output_tokens: session.outputTokens },
      data: { timestamp: new Date().toISOString(), candidates: eligible } };
    await io.save({ timestamp: new Date().toISOString(), candidates: [], job_id: job.id, mode: job.mode, metrics: { ...job.metrics } });
    job.warnings = job.result.warnings;
    job.stage = "Complete"; job.status = "complete";
  } catch (error) {
    job.error = error instanceof Error ? error.message : "Scan failed. Please try again.";
    job.status = "failed"; updateMetrics();
    // Best effort audit: already saved observations survive a later failure.
    try { await io.save({ timestamp: new Date().toISOString(), candidates: [], job_id: job.id, mode: job.mode, metrics: { ...job.metrics } }); }
    catch { /* The original storage/scan failure remains the user-facing error. */ }
  }
}
