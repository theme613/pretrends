import { NextResponse, after } from "next/server";
import { createScanJob, runScan, scanOptions, type ScanJob } from "@/lib/scan-runner";
import { selectRefreshBatch, sameBatchFilters } from "@/lib/refresh-batch";
import { latestTrends } from "@/lib/scan-store";

export const maxDuration = 60;
const state = globalThis as typeof globalThis & { pretrendsScanJob?: ScanJob };
const noStore = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { input = {}; }
  let options;
  try { options = scanOptions(input); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const active = state.pretrendsScanJob;
  if (active?.status === "running") {
    if (!sameBatchFilters(active.filters, options.filters) || active.mode !== options.mode) {
      return NextResponse.json({ error: "Another scan is already running with different filters. Wait for it to finish, then try again." }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ id: active.id, mode: active.mode, filters: active.filters, joined: true }, { status: 202, headers: noStore });
  }
  if (!process.env.APIFY_API_TOKEN)
    return NextResponse.json({ error: "Add APIFY_API_TOKEN to .env.local and restart the server." }, { status: 503 });
  // No await between the active-job check and assignment: duplicate requests
  // in this local process cannot both start paid work.
  const job = createScanJob(options);
  state.pretrendsScanJob = job;
  if (options.mode === "refresh") {
    await runScan(job);
    if (job.status === "failed") {
      return NextResponse.json({ error: job.error || "Scan failed. Please try again." }, { status: 500, headers: noStore });
    }
    const eligible = await latestTrends();
    const batch = selectRefreshBatch(eligible, job.filters, job.freshIds, job.refreshedIds);
    return NextResponse.json({
      id: job.id,
      mode: job.mode,
      filters: job.filters,
      batch,
      status: job.status,
      stage: job.stage,
      processed: job.processed,
      total: job.total,
      revision: job.revision,
      started_at: job.started_at,
      warnings: job.warnings,
      metrics: job.metrics,
      data: { timestamp: new Date().toISOString(), candidates: eligible },
      result: job.result ? { ...job.result, batch, data: { ...job.result.data, candidates: eligible } } : {
        batch,
        live_scan: true as const,
        scraped_count: job.total,
        verified_count: eligible.length,
        warnings: job.warnings,
        ai_usage: { input_tokens: job.metrics.input_tokens, output_tokens: job.metrics.output_tokens },
        data: { timestamp: new Date().toISOString(), candidates: eligible },
      },
    }, { status: 200, headers: noStore });
  }
  after(async () => { await runScan(job); });
  return NextResponse.json({ id: job.id, mode: job.mode, filters: job.filters, joined: false }, { status: 202, headers: noStore });
}
export async function GET(request: Request) {
  const job = state.pretrendsScanJob;
  const parameters = new URL(request.url).searchParams;
  if (!job || parameters.get("id") !== job.id)
    return NextResponse.json({ error: "This scan was interrupted. Refresh saved ideas, then try again." }, { status: 404, headers: noStore });
  const eligible = await latestTrends();
  // Expiration changes eligibility even when no scan write occurred.
  const signature = eligible.map((post) => `${post.platform}:${post.id}:${post.source_verified_at}:${post.collected_at}:${post.content_checked_at}`).sort().join("|");
  if (signature !== job.snapshotSignature) { job.snapshotSignature = signature; job.revision++; }
  const batch = selectRefreshBatch(eligible, job.filters, job.freshIds, job.refreshedIds);
  const changed = parameters.get("since") !== String(job.revision);
  return NextResponse.json({ id: job.id, mode: job.mode, filters: job.filters,
    batch, status: job.status, stage: job.stage, processed: job.processed, total: job.total,
    revision: job.revision, started_at: job.started_at, warnings: job.warnings,
    metrics: { ...job.metrics, elapsed_ms: job.status === "running" ? Date.now() - Date.parse(job.started_at) : job.metrics.elapsed_ms }, error: job.error,
    ...(changed ? { data: { candidates: eligible } } : {}),
    ...(job.result ? { result: { ...job.result, batch, data: { ...job.result.data, candidates: eligible } } } : {}),
  }, { headers: noStore });
}
