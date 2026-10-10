import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { processCandidates, fallback } from "@/lib/agent";
import { validSourceIdentity, type Verification } from "@/lib/post-policy";
import { scrape } from "@/lib/apify";
import {
  readScans,
  saveScan,
  latestTrends,
  compareObservation,
  mergeScans,
  previousObservation,
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
  if (state.pretrendsScanJob?.status === "running") {
    return NextResponse.json(
      { id: state.pretrendsScanJob.id },
      { status: 202 },
    );
  }
  if (!process.env.APIFY_API_TOKEN) {
    return NextResponse.json(
      { error: "Add APIFY_API_TOKEN to .env and restart the dev server." },
      { status: 503 },
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
      job.result = await collect(platforms, topics, selected, job);
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
  selected: string[],
  job: ScanJob,
) {
  const deadline = Date.now() + 14 * 60 * 1000;
  const scans = await readScans();
  const stored = mergeScans(scans);
  const previous = new Map(
    stored.map((post) => [`${post.platform}:${post.id}`, post]),
  );
  const knownByPlatform = platforms.map((platform) =>
    stored
      .filter((post) => {
        if (post.platform !== platform) return false;
        let shortCode = post.short_code;
        if (platform === "Instagram" && !shortCode) {
          try {
            shortCode = new URL(post.url).pathname.match(
              /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/,
            )?.[1];
          } catch {
            return false;
          }
        }
        return (
          validSourceIdentity(post.platform, post.id, post.url, shortCode) &&
          (!selected.length ||
            (Array.isArray(post.categories) &&
              selected.every((category) => post.categories.includes(category))))
        );
      })
      .sort(
        (a, b) =>
          Date.parse(a.source_verified_at || "1970-01-01") -
          Date.parse(b.source_verified_at || "1970-01-01"),
      )
      .slice(0, 100),
  );
  const results = await Promise.allSettled(
    platforms.map((platform, index) =>
      scrape(platform, topics, 300, knownByPlatform[index]),
    ),
  );
  const warnings: string[] = [];
  const verifications: Verification[] = [];
  const posts = results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      verifications.push(...result.value.verifications);
      if (!result.value.posts.length)
        warnings.push(
          `${platforms[index]} returned no verifiable videos with real view counts.`,
        );
      return result.value.posts;
    }
    warnings.push(
      result.reason instanceof Error
        ? result.reason.message
        : `${platforms[index]} could not be scanned.`,
    );
    verifications.push(
      ...knownByPlatform[index].map((post) => ({
        id: post.id,
        platform: post.platform,
        status: "unverified" as const,
        checked_at: new Date().toISOString(),
      })),
    );
    return [];
  });
  const unique = [
    ...new Map(
      posts.map((post) => [`${post.platform}:${post.id}`, post]),
    ).values(),
  ];
  if (!unique.length) {
    // Persist failures so a previous success cannot keep a blocked post visible.
    if (verifications.length)
      await saveScan({
        timestamp: new Date().toISOString(),
        candidates: [],
        verifications,
      });
    throw new Error(
      warnings.join(" ") || "No verified videos were found. Try another topic.",
    );
  }
  const observations = unique.map((post) =>
    compareObservation(post, previousObservation(scans, post)),
  );
  // Freshly discovered videos and known posts share the same 250-check budget.
  const toAnalyze = observations.slice(0, 250);
  job.total = toAnalyze.length;
  job.stage = "Checking video content";
  const analyzed = await processCandidates(
    toAnalyze,
    (processed) => {
      job.processed = processed;
    },
    previous,
    deadline - 90000,
  );
  const candidates = [
    ...analyzed,
    ...observations
      .slice(250)
      .map((post) =>
        fallback(post, "Waiting for a visual check in a later scan."),
      ),
  ];
  const hidden = candidates.filter(
    (candidate) => candidate.content_status !== "verified",
  );
  if (hidden.length)
    warnings.push(
      `${hidden.length} collected post(s) are hidden because their visual content is unconfirmed.`,
    );
  const failures = [
    ...new Set(hidden.map((post) => post.check_error).filter(Boolean)),
  ];
  warnings.push(...(failures.slice(0, 3) as string[]));
  const uncertainSources = verifications.filter(
    (entry) => entry.status !== "available",
  ).length;
  if (uncertainSources)
    warnings.push(
      `${uncertainSources} saved post(s) are hidden because their availability could not be confirmed.`,
    );
  const aiUsage = analyzed.reduce(
    (total, post) => ({
      input_tokens: total.input_tokens + (post.ai_usage?.input_tokens || 0),
      output_tokens: total.output_tokens + (post.ai_usage?.output_tokens || 0),
    }),
    { input_tokens: 0, output_tokens: 0 },
  );
  job.stage = "Saving verified results";
  const scan = {
    timestamp: new Date().toISOString(),
    candidates,
    verifications,
  };
  await saveScan(scan);
  const eligible = await latestTrends();
  return {
    live_scan: true,
    scraped_count: unique.length,
    verified_count: analyzed.filter(
      (post) => post.content_status === "verified",
    ).length,
    warnings,
    ai_usage: aiUsage,
    data: { timestamp: scan.timestamp, candidates: eligible },
  };
}
