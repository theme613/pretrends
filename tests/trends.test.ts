import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateForecast } from "../src/lib/forecast";
import {
  CONTENT_CHECK_VERSION,
  isEligiblePost,
  sharesActivityFrame,
  validSourceIdentity,
} from "../src/lib/post-policy";
import {
  fallback,
  parseVisualResult,
  contentFingerprint,
  processCandidates,
  type TrendCandidate,
} from "../src/lib/agent";
import { parsePost } from "../src/lib/apify";
import {
  compareObservation,
  mergeScans,
  previousObservation,
} from "../src/lib/scan-store";
import { cleanTrendMatterReason, matchesCategories, normalizeTrends, trendGrowthReasons } from "../src/lib/trends";
import { allowedMediaUrl } from "../src/lib/video-frames";

const now = Date.parse("2026-10-10T16:00:00Z");
const evidence = (
  category = "food",
  activity = "cooking_food",
  frames = [1, 2, 3],
) => ({
  category,
  activity,
  frames,
  description:
    category === "food"
      ? "Hands stir ingredients in a saucepan."
      : "A person is singing and strumming a guitar.",
  confident: true,
  active: true as const,
});
function post(overrides: Partial<TrendCandidate> = {}): TrendCandidate {
  const raw = {
    id: "7546234572208377101",
    platform: "TikTok",
    title: "Cooking demonstration",
    creator: "chef",
    url: "https://www.tiktok.com/@chef/video/7546234572208377101",
    views_t0: 1000,
    views_t1: 1240,
    collected_at: "2026-10-10T16:00:00Z",
    baseline_at: "2026-10-10T14:00:00Z",
    has_baseline: true,
  };
  return {
    ...fallback(raw),
    categories: ["food"],
    category_evidence: [evidence()],
    ai_status: "complete",
    content_status: "verified",
    content_check_version: CONTENT_CHECK_VERSION,
    content_checked_at: raw.collected_at,
    source_verified_at: raw.collected_at,
    source_status: "available",
    source_run_id: "real-run-id",
    ...overrides,
  };
}

test("forecast uses actual elapsed hours and targets 72 hours after current observation", () => {
  const result = calculateForecast(post());
  assert.equal(result.status, "ready");
  assert.equal(result.views_per_hour, 120);
  assert.equal(result.estimated_total, 9880);
  assert.equal(result.target_at, "2026-10-13T16:00:00.000Z");
});
test("first observation never invents growth or forecast; current count becomes starting count", () => {
  const initial = compareObservation(post({ has_baseline: false }));
  assert.equal(initial.views_t0, 1240);
  assert.equal(initial.has_baseline, false);
  assert.equal(calculateForecast(initial).estimated_total, null);
});
test("forecast handles zero growth, zero baseline, decreases, short intervals and invalid dates", () => {
  assert.equal(
    calculateForecast(post({ views_t0: 1240 })).estimated_total,
    1240,
  );
  assert.equal(
    calculateForecast(post({ views_t0: 0, views_t1: 2 })).estimated_total,
    74,
  );
  assert.equal(
    calculateForecast(post({ views_t0: 1300 })).status,
    "decreasing_views",
  );
  assert.equal(
    calculateForecast(post({ baseline_at: "2026-10-10T15:59:00Z" })).status,
    "too_soon",
  );
  for (const baseline_at of [
    "invalid",
    "2026-10-10T17:00:00Z",
    "2026-10-10T16:00:00Z",
  ])
    assert.equal(
      calculateForecast(post({ baseline_at })).status,
      "invalid_observations",
    );
});
test("source eligibility hides stale, unavailable, unverified, legacy and malformed records", () => {
  assert.equal(isEligiblePost(post(), now), true);
  for (const changed of [
    { source_status: "unavailable" as const },
    { source_status: "unverified" as const },
    { source_verified_at: "2026-10-03T15:59:59Z" },
    { source_verified_at: "2026-10-11T16:00:00Z" },
    { content_check_version: undefined },
    { category_evidence: [] },
    { views_t1: -1 },
    { categories: ["made_up"] },
  ])
    assert.equal(isEligiblePost(post(changed), now), false);
  assert.equal(
    normalizeTrends(
      [
        {
          title: "Meme coin supercycle",
          id: "t29",
          url: "https://www.tiktok.com",
        },
      ],
      now,
    ).length,
    0,
  );
});
test("singing-only, cooking-only, background songs and misleading captions do not create multi matches", () => {
  const data = (entries: unknown[]) => ({
    evidence: entries,
    score: 0.5,
    reason: "Visible content only.",
    decision: "Try a simple post.",
    steps: ["A", "B", "C"],
  });
  const music = parseVisualResult(
    data([evidence("music", "playing_instrument")]),
  );
  assert.deepEqual(music.categories, ["music"]);
  assert.equal(
    sharesActivityFrame(music.category_evidence, ["food", "music"]),
    false,
  );
  const food = parseVisualResult(
    data([
      evidence(),
      evidence("music", "background_song"),
      { ...evidence("music", "singing"), confident: false },
    ]),
  );
  assert.deepEqual(food.categories, ["food"]);
  const normalized = normalizeTrends(
    [post({ ...food, title: "#music #diner misleading hashtag" })],
    now,
  )[0];
  assert.equal(matchesCategories(normalized, ["music", "food"]), false);
});
test("combined categories require shared frame evidence, separate scenes never qualify", () => {
  const separated = [
    evidence("food", "cooking_food", [1]),
    evidence("music", "singing", [3]),
  ];
  assert.equal(sharesActivityFrame(separated, ["food", "music"]), false);
  const simultaneous = [
    evidence("food", "cooking_food", [1, 2]),
    evidence("music", "singing", [2]),
  ];
  assert.equal(sharesActivityFrame(simultaneous, ["food", "music"]), true);
  const normalized = normalizeTrends(
    [post({ categories: ["food", "music"], category_evidence: simultaneous })],
    now,
  )[0];
  assert.equal(matchesCategories(normalized, ["food", "music"]), true);
  assert.equal(
    matchesCategories(normalized, ["food", "music", "dance"]),
    false,
  );
});
test("invalid or uncertain AI evidence cannot pass visual validation", () => {
  const value = {
    reason: "Explanation",
    decision: "Action",
    steps: ["A", "B", "C"],
    evidence: [
      {
        ...evidence(),
        description: "Person stands at a counter with vegetables.",
      },
      evidence("food", "food_venue"),
      evidence("food", "cooking_food", [4]),
      { ...evidence(), confident: false },
    ],
  };
  assert.deepEqual(parseVisualResult(value).categories, []);
  assert.throws(() => parseVisualResult({ ...value, steps: ["A"] }));
});
test("URL identities must match platform and post; fake IDs, credentials and wrong hosts are rejected", () => {
  assert.equal(validSourceIdentity("TikTok", post().id, post().url), true);
  assert.equal(
    validSourceIdentity(
      "TikTok",
      "t29",
      "https://www.tiktok.com/@fake/video/t29",
    ),
    false,
  );
  assert.equal(validSourceIdentity("TikTok", "123", post().url), false);
  assert.equal(
    validSourceIdentity(
      "TikTok",
      post().id,
      post().url.replace("tiktok.com", "tiktok.com.evil.example"),
    ),
    false,
  );
  assert.equal(
    validSourceIdentity(
      "Instagram",
      "567",
      "https://www.instagram.com/reel/ABC/",
      "ABC",
    ),
    true,
  );
  assert.equal(
    validSourceIdentity(
      "Instagram",
      "567",
      "https://www.instagram.com/reel/WRONG/",
      "ABC",
    ),
    false,
  );
  assert.equal(allowedMediaUrl("https://cdn.example.com/file.mp4"), false);
  assert.equal(allowedMediaUrl("https://127.0.0.1/file.mp4"), false);
  assert.equal(allowedMediaUrl("https://v16.tiktokcdn.com/file.mp4"), true);
});
test("scraper parser preserves real caption/media and rejects error rows and fake metrics", () => {
  const item = {
    id: post().id,
    title: "a".repeat(350),
    channel: { username: "chef" },
    views: 1240,
    postPage: post().url,
    video: { url: "https://v16.tiktokcdn.com/file.mp4", duration: 30 },
  };
  const parsed = parsePost(item, "TikTok")!;
  assert.equal(parsed.caption?.length, 350);
  assert.equal(parsed.title.length, 180);
  assert.equal(parsed.video_url, item.video.url);
  for (const changed of [
    { error: "not found" },
    { isPrivate: true },
    { views: undefined },
    { views: "" },
    { views: true },
    { views: 1.5 },
    { views: -1 },
    { postPage: post().url.replace(post().id, "999") },
  ])
    assert.equal(parsePost({ ...item, ...changed }, "TikTok"), null);
  assert.equal(
    parsePost({ ...item, views: undefined, likes: 9000 }, "TikTok"),
    null,
  );
});
test("a failed later verification overrides success and keeps count history", () => {
  const good = post();
  const failed = {
    id: good.id,
    platform: good.platform,
    status: "unverified" as const,
    checked_at: "2026-10-10T16:01:00Z",
  };
  const scans = [
    { timestamp: good.collected_at, candidates: [good] },
    { timestamp: failed.checked_at, candidates: [], verifications: [failed] },
  ];
  const merged = mergeScans(scans)[0];
  assert.equal(isEligiblePost(merged, now + 60000), false);
  assert.equal(merged.views_t1, good.views_t1);
  const next = post({ collected_at: "2026-10-10T18:00:00Z", views_t1: 1800 });
  assert.equal(previousObservation(scans, next)?.views_t1, 1240);
  assert.equal(
    compareObservation(next, previousObservation(scans, next)).views_t0,
    1240,
  );
});
test("deduplication uses platform plus ID; old AI forecast values are ignored", () => {
  const original = post();
  const duplicate = post({
    collected_at: "2026-10-10T15:00:00Z",
    views_t1: 1100,
  });
  const other = post({
    platform: "Instagram",
    short_code: "ABC",
    url: "https://www.instagram.com/reel/ABC/",
  });
  assert.equal(
    mergeScans([
      { timestamp: original.collected_at, candidates: [original, other] },
      { timestamp: duplicate.collected_at, candidates: [duplicate] },
    ]).length,
    2,
  );
  const result = normalizeTrends(
    [{ ...original, predicted_views: 9999999999 }],
    now,
  )[0];
  assert.equal(result.predictedViews, 9880);
  assert.equal(result.currentViews, 1240);
});
test("content cache excludes view-count changes, but invalidates changed content", async () => {
  const original = post();
  original.content_fingerprint = contentFingerprint(original);
  assert.equal(
    contentFingerprint(post({ views_t1: 2000 })),
    original.content_fingerprint,
  );
  assert.notEqual(
    contentFingerprint(post({ title: "Different video" })),
    original.content_fingerprint,
  );
  const result = await processCandidates(
    [post({ views_t1: 2000 })],
    undefined,
    new Map([[`${original.platform}:${original.id}`, original]]),
  );
  assert.equal(result[0].ai_status, "complete");
  assert.equal(result[0].views_t1, 2000);
  assert.equal(result[0].forecast?.estimated_total, 38000);
  assert.equal(result[0].ai_usage, undefined);
});

test("source rechecks hide deleted posts without treating blocked or missing searches as deletion", async () => {
  const { scrape } = await import("../src/lib/apify");
  const originalFetch = globalThis.fetch;
  const token = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = "test-only-token";
  try {
    const known = post();
    for (const row of [
      { inputSource: known.url, error: "not-found" },
      { inputSource: known.url, error: "blocked" },
      undefined,
    ]) {
      globalThis.fetch = async (input, options) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          const body = JSON.parse(String(options?.body));
          assert.equal(body.startUrls[0], known.url);
          return Response.json({
            data: {
              id: "test-run",
              defaultDatasetId: "test-dataset",
              status: "SUCCEEDED",
            },
          });
        }
        return Response.json(row ? [row] : []);
      };
      const result = await scrape("TikTok", [], 1, [known]);
      assert.equal(result.posts.length, 0);
      if (row?.error === "not-found") {
        assert.equal(result.verifications[0].status, "unavailable");
      } else {
        assert.deepEqual(result.verifications, []);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (token === undefined) delete process.env.APIFY_API_TOKEN;
    else process.env.APIFY_API_TOKEN = token;
  }
});

test("API returns only eligible source posts and matching category counts", async () => {
  const { GET: getTrends } = await import("../src/app/api/trends/route");
  const { GET: getCategories } = await import(
    "../src/app/api/categories/route"
  );
  const response = await getTrends(new Request("http://localhost/api/trends"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert(data.every((entry: TrendCandidate) => isEligiblePost(entry)));
  const categories = await (await getCategories()).json();
  const actual: Record<string, number> = {};
  for (const entry of data)
    for (const category of new Set<string>(entry.categories))
      actual[category] = (actual[category] || 0) + 1;
  assert.deepEqual(
    categories,
    Object.entries(actual).map(([name, count]) => ({ name, count })),
  );
  const combined = await (
    await getTrends(
      new Request("http://localhost/api/trends?categories=food,music"),
    )
  ).json();
  assert(
    normalizeTrends(combined).every((entry) =>
      matchesCategories(entry, ["food", "music"]),
    ),
  );
});

test("display predictions compute true growth from snapshot history and show collecting data for single snapshot", async () => {
  const { predictionDisplay } = await import("../src/lib/forecast");
  const real = calculateForecast(post());
  const display = predictionDisplay(1240, real, 2);
  assert.equal(display.method, "observed_growth");
  assert.equal(display.estimated_total, 9880);
  assert.equal(display.hourly_rate, 120);

  // Single snapshot or unavailable history must NOT show a fake 25% number
  for (const status of ["first_observation", "too_soon", "invalid_observations", "decreasing_views"] as const) {
    const singleSnapshot = predictionDisplay(101, { ...real, status, estimated_total: null });
    assert.equal(singleSnapshot.method, "collecting_data");
    assert.equal(singleSnapshot.estimated_total, null);
    assert.equal(singleSnapshot.status_message, "Collecting data — check back after next scan");
  }

  const source = post({ has_baseline: false });
  const normalized = normalizeTrends([source], now)[0];
  assert.equal(normalized.predictedViews, null);
  assert.equal(normalized.prediction.method, "collecting_data");
  assert.equal(normalized.prediction.estimated_total, null);
  assert.equal(normalized.currentViews, 1240);
  assert.equal(normalized.score, normalizeTrends([post()], now)[0].score);
});

test("frequent refreshes keep the latest hour-old baseline without hiding count decreases", () => {
  const old = post({ collected_at: "2026-10-10T14:00:00Z", views_t1: 1000 });
  const recent = post({ collected_at: "2026-10-10T15:50:00Z", views_t1: 1200 });
  const scans = [{ timestamp: recent.collected_at, candidates: [old, recent] }];
  const previous = previousObservation(scans, post());
  assert.equal(previous, old);
  assert.equal(calculateForecast(compareObservation(post(), previous)).status, "ready");
  assert.equal(previousObservation(scans, post({ views_t1: 1100 })), recent);
  assert.equal(calculateForecast(compareObservation(post({ views_t1: 1100 }), recent)).status, "decreasing_views");
  assert.equal(previousObservation([{ timestamp: recent.collected_at, candidates: [recent] }], post()), recent);
});

test("cleanTrendMatterReason removes negative filler sentences about what is not visible", () => {
  const dirty = "Frame 1 features active driving at night. No food, music, fashion, tech, game, meme, sports, crypto, or dance activities are visible. The content is exclusively automotive-focused.";
  const cleaned = cleanTrendMatterReason(dirty);
  assert.equal(cleaned, "Frame 1 features active driving at night. The content is exclusively automotive-focused.");
  assert.ok(!cleaned.includes("No food"));

  const dirty2 = "The subject poses in a dark coat. No other activities like cooking or music performance are visible.";
  const cleaned2 = cleanTrendMatterReason(dirty2);
  assert.equal(cleaned2, "The subject poses in a dark coat.");
});

test("trendGrowthReasons returns 2-4 evidence-driven bullets with real computed numbers", () => {
  const p1 = normalizeTrends([post()], now)[0];
  const p2 = normalizeTrends([post({ id: "7546234572208377102", url: "https://www.tiktok.com/@chef/video/7546234572208377102", views_t0: 500, views_t1: 1500, score: 0.95 })], now)[0];
  const collection = [p1, p2];

  const reasons1 = trendGrowthReasons(p1, collection);
  assert.ok(reasons1.length >= 2 && reasons1.length <= 4);
  for (const reason of reasons1) {
    assert.match(reason.detail, /\d+(\.\d+)?/);
  }

  const reasons2 = trendGrowthReasons(p2, collection);
  assert.ok(reasons2.length >= 2 && reasons2.length <= 4);
  assert.notEqual(reasons1[0].detail, reasons2[0].detail);
});
