import type { RefreshBatch } from "./refresh-batch";
export type ScanClientResult = {
  data: { candidates: unknown[] };
  batch?: RefreshBatch;
};
class IdeaUpdateError extends Error {
  // A conflict means another scan owns the collection; nothing needs recovering.
  constructor(
    message: string,
    readonly conflict = false,
  ) {
    super(message);
  }
}
const updateFailed =
  "Could not update ideas. Your saved ideas are still here. Please try again.";
const updateTimedOut =
  "This search took too long. Your saved ideas are still here. Please try again.";
async function readScanResponse(response: Response) {
  const result = await response.json().catch(() => null);
  if (response.status === 504) throw new IdeaUpdateError(updateTimedOut);
  if (result?.code === "MISSING_CONFIGURATION") {
    throw new IdeaUpdateError(
      "Fresh ideas are not set up on this website yet. Your saved ideas are still available.",
    );
  }
  if (response.status === 409 && typeof result?.error === "string")
    throw new IdeaUpdateError(result.error, true);
  if (!response.ok || !result || result.status === "failed")
    throw new IdeaUpdateError(updateFailed);
  return result;
}

export async function refreshIdeas({
  signal,
  categories: selectedCategories,
  platform,
  onCollection,
  onMessage,
  onComplete,
}: {
  signal: AbortSignal;
  categories: string[];
  platform: string;
  onCollection: (data: unknown, keepCurrent?: boolean) => void;
  onMessage: (message: string) => void;
  onComplete: (result: ScanClientResult) => void;
}) {
  onMessage("Finding fresh ideas…");
  const delayed = "Still finding ideas. You can keep browsing.";
  const slowTimer = setTimeout(() => onMessage(delayed), 40000);
  // Visibility changes wake the existing poll; they do not start another scan.
  const waitForPoll = () =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", wake);
        signal.removeEventListener("abort", abort);
      };
      const wake = () => {
        if (document.visibilityState === "visible") {
          cleanup();
          resolve();
        }
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          cleanup();
          resolve();
        },
        document.visibilityState === "hidden" ? 10000 : 2000,
      );
      document.addEventListener("visibilitychange", wake);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  // Measure elapsed work with a monotonic clock, independent of wall-clock changes.
  const started = performance.now();
  const requestSignal = (timeout = 20000) =>
    AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categories: selectedCategories,
        platform,
        mode: "refresh",
      }),
      cache: "no-store",
      signal: requestSignal(310000),
    });
    let result = await readScanResponse(response);
    if (response.status === 202) {
      const id = result.id;
      let revision = -1;
      while (true) {
        if (performance.now() - started > 15 * 60000)
          throw new IdeaUpdateError(updateTimedOut);
        const progressResponse = await fetch(
          `/api/scan?id=${encodeURIComponent(id)}&since=${revision}`,
          { cache: "no-store", signal: requestSignal() },
        );
        const progress = await readScanResponse(progressResponse);
        if (progress.data) onCollection(progress.data.candidates);
        revision = progress.revision ?? revision;
        if (progress.status === "complete") {
          result = progress.result;
          break;
        }
        onMessage(
          performance.now() - started >= 40000
            ? delayed
            : "Finding fresh ideas…",
        );
        await waitForPoll();
      }
    }
    if (!Array.isArray(result?.data?.candidates))
      throw new IdeaUpdateError(updateFailed);
    onCollection(result.data.candidates);
    onComplete(result);
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof IdeaUpdateError && error.conflict) {
      onMessage(error.message);
      return;
    }
    try {
      const latest = await fetch("/api/trends", {
        cache: "no-store",
        signal: requestSignal(),
      });
      if (latest.ok) {
        const collection = await latest.json();
        if (Array.isArray(collection)) onCollection(collection, true);
      }
    } catch {
      /* Keep the current verified ideas available if the read fails. */
    }
    if (!signal.aborted)
      onMessage(
        error instanceof IdeaUpdateError
          ? error.message
          : error instanceof Error && error.name === "TimeoutError"
            ? updateTimedOut
            : updateFailed,
      );
  } finally {
    clearTimeout(slowTimer);
  }
}
