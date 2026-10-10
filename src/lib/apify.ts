import type { ScrapedData } from "./agent";
import { validSourceIdentity, type Verification } from "./post-policy";

type Item = Record<string, unknown>;
const object = (value: unknown): Item =>
  value && typeof value === "object" ? (value as Item) : {};
const webUrl = (value: unknown) =>
  typeof value === "string" && /^https:\/\//.test(value) ? value : undefined;

export function parsePost(item: Item, platform: string): ScrapedData | null {
  if (
    item.error ||
    item.errorDescription ||
    item.isPrivate === true ||
    item.isDeleted === true
  )
    return null;
  const author = object(item.author);
  const authorMeta = object(item.authorMeta);
  const stats = object(item.stats);
  const channel = object(item.channel);
  const video = object(item.video);
  const rawViews =
    platform === "Instagram"
      ? (item.videoPlayCount ?? item.videoViewCount)
      : (item.views ?? item.playCount ?? item.play_count ?? stats.playCount);
  // Likes are not views; missing metrics must not become invented counts.
  if (
    rawViews === null ||
    rawViews === undefined ||
    !["string", "number"].includes(typeof rawViews) ||
    String(rawViews).trim() === "" ||
    !Number.isSafeInteger(Number(rawViews)) ||
    Number(rawViews) < 0
  )
    return null;
  const creator = String(
    item.ownerUsername ??
      author.uniqueId ??
      authorMeta.name ??
      channel.username ??
      item.authorName ??
      "unknown",
  );
  const id = item.id ?? item.aweme_id ?? item.shortCode;
  if (!id) return null;
  const shortCode =
    typeof item.shortCode === "string" ? item.shortCode : undefined;
  const url =
    platform === "Instagram"
      ? (webUrl(item.url ?? item.postUrl) ??
        (item.shortCode
          ? `https://www.instagram.com/p/${item.shortCode}/`
          : undefined))
      : (webUrl(
          item.postPage ??
            item.webVideoUrl ??
            item.share_url ??
            video.share_url ??
            item.url,
        ) ??
        (creator !== "unknown"
          ? `https://www.tiktok.com/@${creator}/video/${id}`
          : undefined));
  if (!url || !validSourceIdentity(platform, String(id), url, shortCode))
    return null;
  const caption = String(
    item.caption ?? item.desc ?? item.text ?? item.title ?? `${platform} video`,
  );
  const media = object(item.videoMeta);
  const videoUrl = webUrl(
    item.videoUrl ??
      video.url ??
      video.downloadAddr ??
      video.playAddr ??
      media.downloadAddr,
  );
  const duration = Number(
    item.videoDuration ?? video.duration ?? media.duration,
  );
  return {
    id: String(id),
    title: caption.slice(0, 180),
    caption,
    short_code: shortCode,
    video_url: videoUrl,
    duration_seconds:
      Number.isFinite(duration) && duration > 0 ? duration : undefined,
    published_at:
      typeof (item.timestamp ?? item.uploadedAtFormatted) === "string"
        ? String(item.timestamp ?? item.uploadedAtFormatted)
        : undefined,
    creator,
    platform,
    url,
    image: webUrl(
      item.displayUrl ??
        item.thumbnail ??
        object(item.videoMeta).coverUrl ??
        video.cover,
    ),
    views_t0: null,
    views_t1: Number(rawViews),
    collected_at: new Date().toISOString(),
  };
}

export async function scrape(
  platform: "Instagram" | "TikTok",
  hashtags: string[],
  limit = 300,
  knownPosts: ScrapedData[] = [],
  options: { maxChargeUsd?: number } = {},
): Promise<{
  posts: ScrapedData[];
  verifications: Verification[];
  run_id: string;
  warnings: string[];
  scrape_ms: number;
}> {
  const startedAt = Date.now();
  const maxCharge = options.maxChargeUsd ?? 1;
  const actor =
    platform === "Instagram"
      ? "apify~instagram-scraper"
      : "apidojo~tiktok-scraper-api";
  const input =
    platform === "Instagram"
      ? {
          directUrls: [
            ...knownPosts.map((post) => post.url),
            ...hashtags.map(
              (hashtag) => `https://www.instagram.com/explore/tags/${hashtag}/`,
            ),
          ],
          resultsType: "reels",
          resultsLimit: hashtags.length
            ? Math.max(1, Math.floor((limit - knownPosts.length) / hashtags.length))
            : 1,
        }
      : {
          startUrls: [
            ...knownPosts.map((post) => post.url),
            ...hashtags.map(
              (hashtag) => `https://www.tiktok.com/tag/${hashtag}`,
            ),
          ],
          maxItems: limit,
        };
  const headers = {
    Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  async function call(endpoint: string, options: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetch(`https://api.apify.com/v2/${endpoint}`, {
        ...options,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(65000),
      });
    } catch {
      throw new Error(`${platform}: Apify did not respond. Try again later.`);
    }
    if (!response.ok) {
      const message =
        response.status === 401
          ? "Apify rejected the API token. Update APIFY_API_TOKEN."
          : response.status === 402 || response.status === 403
            ? "Check your Apify credits and permission to use this scraper."
            : `Apify returned HTTP ${response.status}. Check the actor run in your Apify console.`;
      throw new Error(`${platform}: ${message}`);
    }
    return response.json();
  }
  const started = await call(
    `acts/${actor}/runs?timeout=480&maxTotalChargeUsd=${maxCharge}&waitForFinish=0`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  let run = started.data;
  if (!run?.id || !run.defaultDatasetId)
    throw new Error(`${platform}: Apify did not return a run ID.`);
  const deadline = Date.now() + 510000;
  while (
    ["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status) &&
    Date.now() < deadline
  ) {
    run = (await call(`actor-runs/${run.id}?waitForFinish=60`)).data;
  }
  if (run.status !== "SUCCEEDED")
    throw new Error(
      `${platform}: Scraper ${String(run.status).toLowerCase()}. Check the run and your credits in Apify.`,
    );
  // Read every raw row, including errors. Filtered pagination can skip rows and
  // falsely label known posts as missing.
  const items: unknown[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page: unknown = await call(
      `datasets/${run.defaultDatasetId}/items?clean=false&offset=${offset}&limit=${pageSize}`,
    );
    if (!Array.isArray(page)) throw new Error(`${platform}: Apify returned an unexpected response.`);
    items.push(...page);
    if (page.length < pageSize) break;
    if (items.length >= 10000) throw new Error(`${platform}: Dataset exceeded the safe read limit; availability is uncertain.`);
  }
  const checkedAt = new Date().toISOString();
  const posts = items.flatMap((item) => {
    const post = parsePost(object(item), platform);
    if (!post) return [];
    const known = knownPosts.find((entry) => entry.id === post.id);
    if (
      known &&
      new URL(known.url).pathname.replace(/\/$/, "") !==
        new URL(post.url).pathname.replace(/\/$/, "") &&
      platform === "TikTok"
    )
      return [];
    return [
      {
        ...post,
        source_status: "available" as const,
        source_verified_at: checkedAt,
        source_run_id: String(run.id),
      },
    ];
  });
  const found = new Set(posts.map((post) => post.id));
  const verifications: Verification[] = knownPosts.map((post) => {
    const errorRow = items
      .map(object)
      .find(
        (row) =>
          (row.inputUrl === post.url ||
            row.inputSource === post.url ||
            row.url === post.url ||
            String(row.id) === post.id) &&
          (row.error || row.isPrivate === true || row.isDeleted === true),
      );
    const explicitUnavailable =
      errorRow &&
      (errorRow.isPrivate === true ||
        errorRow.isDeleted === true ||
        ["not-found", "not_found", "deleted", "private"].includes(
          String(errorRow.error).toLowerCase(),
        ));
    return {
      id: post.id,
      platform,
      checked_at: checkedAt,
      run_id: String(run.id),
      status: explicitUnavailable
        ? "unavailable"
        : errorRow
          ? "unverified"
          : found.has(post.id)
            ? "available"
            : "unverified",
    };
  });
  const warnings: string[] = [];
  if (Number(run.usageTotalUsd) >= maxCharge * 0.95 || /charge|budget|cost limit/i.test(String(run.statusMessage || "")))
    warnings.push(`${platform}: Scraper reached its charge limit; fewer posts may be available.`);
  return { posts, verifications, run_id: String(run.id), warnings, scrape_ms: Date.now() - startedAt };
}
