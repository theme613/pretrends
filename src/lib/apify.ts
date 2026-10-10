import type { ScrapedData } from "./agent";

type Item = Record<string, unknown>;
const object = (value: unknown): Item =>
  value && typeof value === "object" ? (value as Item) : {};
const webUrl = (value: unknown) =>
  typeof value === "string" && /^https:\/\//.test(value) ? value : undefined;

export function parsePost(item: Item, platform: string): ScrapedData | null {
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
    !Number.isFinite(Number(rawViews)) ||
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
  if (!url) return null;
  return {
    id: String(id),
    title: String(
      item.caption ??
        item.desc ??
        item.text ??
        item.title ??
        `${platform} video`,
    ).slice(0, 180),
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
): Promise<ScrapedData[]> {
  const actor =
    platform === "Instagram"
      ? "apify~instagram-scraper"
      : "apidojo~tiktok-scraper-api";
  const input =
    platform === "Instagram"
      ? {
          directUrls: hashtags.map(
            (hashtag) => `https://www.instagram.com/explore/tags/${hashtag}/`,
          ),
          resultsType: "reels",
          resultsLimit: Math.ceil(limit / hashtags.length),
        }
      : {
          startUrls: hashtags.map(
            (hashtag) => `https://www.tiktok.com/tag/${hashtag}`,
          ),
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
    `acts/${actor}/runs?timeout=480&maxTotalChargeUsd=1&waitForFinish=0`,
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
  const items: unknown = await call(
    `datasets/${run.defaultDatasetId}/items?clean=true&limit=${limit}`,
  );
  if (!Array.isArray(items))
    throw new Error(`${platform}: Apify returned an unexpected response.`);
  return items.flatMap((item) => {
    const post = parsePost(object(item), platform);
    return post ? [post] : [];
  });
}
