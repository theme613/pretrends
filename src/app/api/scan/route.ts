import { NextResponse, after } from "next/server";
import { createScanJob, runScan, scanOptions, type ScanJob } from "@/lib/scan-runner";
import { selectRefreshBatch, sameBatchFilters } from "@/lib/refresh-batch";
import { latestTrends } from "@/lib/scan-store";

// Node.js is the default runtime; `runtime` cannot be set with cacheComponents.
export const maxDuration = 300;
const state = globalThis as typeof globalThis & {
  pretrendsScanJob?: ScanJob;
  pretrendsScanWork?: Promise<void>;
};
const noStore = { "Cache-Control": "no-store" };

function completedResponse(job: ScanJob) {
  if (job.status === "failed" || !job.result) {
    return NextResponse.json({ code: "SCAN_FAILED", error: job.error || "Scan failed. Please try again." }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ ...job.result, id: job.id, mode: job.mode, filters: job.filters,
    status: job.status, stage: job.stage, processed: job.processed, total: job.total,
    revision: job.revision, started_at: job.started_at, metrics: job.metrics,
  }, { headers: noStore });
}

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { input = {}; }
  let options;
  try { options = scanOptions(input); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400, headers: noStore }); }
  // A separate Vercel invocation cannot reliably poll a job held in this process.
  const synchronous = Boolean(process.env.VERCEL) || options.mode === "refresh";
  const active = state.pretrendsScanJob;
  if (active?.status === "running" && Date.now() - Date.parse(active.started_at) < (synchronous ? 300000 : 900000)) {
    if (!sameBatchFilters(active.filters, options.filters) || active.mode !== options.mode) {
      return NextResponse.json({ error: "Another scan is already running with different filters. Wait for it to finish, then try again." }, { status: 409, headers: noStore });
    }
    if (synchronous) {
      if (!state.pretrendsScanWork) {
        return NextResponse.json({ error: "Another scan is finishing. Please try again shortly." }, { status: 409, headers: noStore });
      }
      await state.pretrendsScanWork;
      return completedResponse(active);
    }
    return NextResponse.json({ id: active.id, mode: active.mode, filters: active.filters, joined: true }, { status: 202, headers: noStore });
  }
  const required = ["APIFY_API_TOKEN", "GRAFILAB_API_KEY", ...(process.env.VERCEL ? ["BLOB_READ_WRITE_TOKEN"] : [])];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    return NextResponse.json({ code: "MISSING_CONFIGURATION", error: `Add ${missing.join(", ")} to ${process.env.VERCEL ? "Vercel environment variables and redeploy" : ".env.local and restart the server"}.` }, { status: 503, headers: noStore });
  }
  // No await between the active-job check and assignment: duplicate requests
  // in this local process cannot both start paid work.
  const job = createScanJob(options);
  state.pretrendsScanJob = job;
  if (synchronous) {
    state.pretrendsScanWork = runScan(job);
    await state.pretrendsScanWork;
    return completedResponse(job);
  }
  after(async () => { state.pretrendsScanWork = runScan(job); await state.pretrendsScanWork; });
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
