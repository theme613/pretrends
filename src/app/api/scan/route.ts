import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { processCandidates, type TrendCandidate } from "@/lib/agent";
import { scrape } from "@/lib/apify";
import {
  readScans,
  saveScan,
  latestTrends,
  compareObservation,
} from "@/lib/scan-store";

export const maxDuration = 900;
type ScanJob = {
  id: string;
  status: "running" | "complete" | "failed";
  stage: string;
  processed: number;
  total: number;
  result?: Awaited<ReturnType<typeof collect>>;
  error?: string;
};
const state = globalThis as typeof globalThis & { pretrendsScanJob?: ScanJob };
const hashtags: Record<string, string[]> = {
  fashion: [
    "fashion",
    "outfit",
    "streetwear",
    "style",
    "vintagefashion",
    "thrift",
    "ootd",
    "fashioninspo",
    "styling",
    "y2k",
  ],
  food: [
    "cooking",
    "food",
    "baking",
    "ramen",
    "sushi",
    "pizza",
    "pasta",
    "breakfast",
    "smoothie",
    "dessert",
  ],
  tech: [
    "technology",
    "ai",
    "smallbusinesstips",
    "productivity",
    "automation",
    "gadgets",
    "software",
    "coding",
    "startup",
    "techreview",
  ],
  music: [
    "music",
    "indiepop",
    "singing",
    "guitar",
    "piano",
    "livemusic",
    "newmusic",
    "songwriter",
    "cover",
    "musician",
  ],
  game: [
    "gaming",
    "videogames",
    "minecraft",
    "fortnite",
    "roblox",
    "esports",
    "gameplay",
    "gamer",
    "playstation",
    "nintendo",
  ],
  meme: [
    "memes",
    "comedy",
    "funny",
    "relatable",
    "humor",
    "sketch",
    "jokes",
    "workmemes",
    "funnyvideos",
    "officehumor",
  ],
  sports: [
    "fitness",
    "sports",
    "football",
    "basketball",
    "running",
    "gym",
    "workout",
    "cycling",
    "yoga",
    "tennis",
  ],
  car: [
    "cars",
    "automotive",
    "supercars",
    "carreview",
    "electriccars",
    "detailing",
    "carspotting",
    "classiccars",
    "motorsport",
    "carlife",
  ],
  crypto: [
    "crypto",
    "bitcoin",
    "ethereum",
    "blockchain",
    "web3",
    "cryptonews",
    "defi",
    "fintech",
    "cryptocurrency",
    "digitalassets",
  ],
  dance: [
    "dance",
    "choreography",
    "dancechallenge",
    "hiphopdance",
    "ballet",
    "salsa",
    "kpopdance",
    "dancer",
    "freestyledance",
    "danceclass",
  ],
};

export async function POST(request: Request) {
  if (!process.env.APIFY_API_TOKEN)
    return NextResponse.json(
      { error: "Add APIFY_API_TOKEN to .env.local." },
      { status: 503 },
    );
  if (state.pretrendsScanJob?.status === "running") {
    return NextResponse.json(
      { id: state.pretrendsScanJob.id },
      { status: 202 },
    );
  }
  let input: { categories?: unknown; platform?: unknown };
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  if (!input || typeof input !== "object")
    return NextResponse.json(
      { error: "Invalid scan request." },
      { status: 400 },
    );
  if (
    input.platform &&
    !["all", "TikTok", "Instagram"].includes(String(input.platform))
  ) {
    return NextResponse.json(
      {
        error:
          "Live scans currently support TikTok and Instagram. Choose one of those platforms or All platforms.",
      },
      { status: 400 },
    );
  }
  const selected = Array.isArray(input.categories)
    ? input.categories
        .filter(
          (c): c is string =>
            typeof c === "string" && Object.hasOwn(hashtags, c),
        )
        .slice(0, 4)
    : [];
  const topics = selected.length
    ? [
        ...new Set(
          selected.flatMap((category) =>
            hashtags[category].slice(0, Math.floor(20 / selected.length)),
          ),
        ),
      ].slice(0, 20)
    : Object.values(hashtags).map((tags) => tags[0]);
  const platforms: ("Instagram" | "TikTok")[] =
    input.platform === "Instagram"
      ? ["Instagram"]
      : input.platform === "TikTok"
        ? ["TikTok"]
        : ["Instagram", "TikTok"];
  const job: ScanJob = {
    id: randomUUID(),
    status: "running",
    stage: "Collecting posts…",
    processed: 0,
    total: 0,
  };
  state.pretrendsScanJob = job;
  after(async () => {
    try {
      job.result = await collect(platforms, topics, job);
      job.status = "complete";
    } catch (error) {
      job.error =
        error instanceof Error
          ? error.message
          : "Scan failed. Please try again.";
      job.status = "failed";
    }
  });
  return NextResponse.json({ id: job.id }, { status: 202 });
}

export async function GET(request: Request) {
  const job = state.pretrendsScanJob;
  if (!job || new URL(request.url).searchParams.get("id") !== job.id) {
    return NextResponse.json(
      {
        error:
          "This scan was interrupted. Refresh saved ideas, then try again.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}

async function collect(
  platforms: ("Instagram" | "TikTok")[],
  topics: string[],
  job: ScanJob,
) {
  try {
    const scans = await readScans();
    const results = await Promise.allSettled(
      platforms.map((platform) => scrape(platform, topics, 300)),
    );
    const warnings = results.flatMap((result) =>
      result.status === "rejected"
        ? [
            result.reason instanceof Error
              ? result.reason.message
              : "A platform could not be scanned.",
          ]
        : [],
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && !result.value.length)
        warnings.push(
          `${platforms[index]} returned no videos with view counts. Try another category.`,
        );
    });
    const posts = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (!posts.length)
      throw new Error(
        warnings.join(" ") ||
          "No videos with view counts were found. Try a different category.",
      );
    const unique = [
      ...new Map(
        posts.map((post) => [`${post.platform}:${post.id}`, post]),
      ).values(),
    ];
    const previous = new Map<string, TrendCandidate>();
    for (const scan of scans)
      for (const post of scan.candidates) {
        const key = `${post.platform}:${post.id}`;
        if (!previous.has(key) && Number.isFinite(post.views_t1))
          previous.set(key, post);
      }
    const observations = unique.map((post) =>
      compareObservation(post, previous.get(`${post.platform}:${post.id}`)),
    );
    job.total = observations.length;
    job.stage = "Preparing AI guidance";
    const candidates = await processCandidates(observations, (processed) => {
      job.processed = processed;
    });
    job.stage = "Saving posts…";
    const unavailable = candidates.filter(
      (candidate) => candidate.ai_status === "unavailable",
    ).length;
    if (unavailable)
      warnings.push(
        `AI guidance was unavailable for ${unavailable} post(s). Real post details are still available.`,
      );
    const scan = { timestamp: new Date().toISOString(), candidates };
    await saveScan(scan);
    return {
      live_scan: true,
      scraped_count: candidates.length,
      warnings,
      data: { ...scan, candidates: await latestTrends() },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Apify") ||
        error.message.includes("videos with view counts") ||
        error.message.includes("Scraper"))
    )
      throw error;
    throw new Error(
      "Could not complete or save the scan. Please check the server and try again.",
    );
  }
}
