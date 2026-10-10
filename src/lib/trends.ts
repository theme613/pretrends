import {
  isEligiblePost,
  sharesActivityFrame,
  type CategoryEvidence,
} from "./post-policy";
import { calculateForecast, predictionDisplay, type PredictionDisplay, type Forecast } from "./forecast";
import type { TrendCandidate } from "./agent";
export type Trend = {
  id: string;
  title: string;
  creator: string;
  platform: string;
  categories: string[];
  before: number | null;
  image: string | null;
  previewUrl?: string;
  steps: string[];
  collectedAt: string | null;
  baselineAt: string | null;
  publishedAt?: string | null;
  aiStatus: string;
  after: number | null;
  hasBaseline: boolean;
  score: number;
  reason: string;
  decision: string;
  url: string | null;
  predictedViews: number | null;
  forecast: Forecast;
  prediction: PredictionDisplay;
  sourceVerifiedAt: string;
  categoryEvidence: CategoryEvidence[];
  currentViews: number;
  snapshots?: Array<{ views: number; timestamp: string }>;
  hourlyGrowthRate?: number | null;
  hoursBetween?: number | null;
  snapshotCount: number;
};
export const categories = [
  {
    id: "all",
    label: "All ideas",
  },
  {
    id: "fashion",
    label: "Fashion",
  },
  {
    id: "food",
    label: "Cooking",
  },
  {
    id: "tech",
    label: "Tech & AI",
  },
  {
    id: "music",
    label: "Music",
  },
  {
    id: "game",
    label: "Gaming",
  },
  {
    id: "meme",
    label: "Memes",
  },
  {
    id: "sports",
    label: "Sports",
  },
  {
    id: "car",
    label: "Cars",
  },
  {
    id: "crypto",
    label: "Crypto",
  },
  {
    id: "dance",
    label: "Dance",
  },
];

function cleanText(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|([^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g,
      "$1",
    )
    .replace(/\uFFFD/g, "");
}

export function normalizeTrends(data: unknown, now = Date.now()): Trend[] {
  if (!Array.isArray(data)) throw new Error("Invalid trend data");
  return data.flatMap((item): Trend[] => {
    if (!item || typeof item !== "object" || typeof item.title !== "string")
      return [];
    const candidate = item as TrendCandidate;
    if (!isEligiblePost(candidate, now)) return [];
    const hasBaseline =
      candidate.has_baseline !== undefined
        ? candidate.has_baseline === true
        : Boolean(candidate.baseline_at);
    const forecast = !hasBaseline
      ? calculateForecast({ ...candidate, has_baseline: false })
      : (candidate.forecast ?? calculateForecast(candidate));
    const snapshots = Array.isArray(candidate.snapshots) ? candidate.snapshots : [];
    const hoursBetween =
      candidate.hours_between ??
      (candidate.baseline_at && candidate.collected_at
        ? (Date.parse(candidate.collected_at) -
            Date.parse(candidate.baseline_at)) /
          3600000
        : null);
    const hourlyGrowthRate =
      candidate.hourly_growth_rate ?? forecast.views_per_hour ?? null;
    const prediction = predictionDisplay(
      candidate.views_t1,
      forecast,
      hoursBetween,
    );
    const id = `${candidate.platform}:${candidate.id}`;
    const rawScore = Number((candidate as { breakout_score?: number }).breakout_score ?? candidate.score ?? 0);
    const url =
      typeof candidate.url === "string" && /^https?:\/\//i.test(candidate.url)
        ? candidate.url
        : null;
    return [
      {
        id,
        title: cleanText(candidate.title),
        creator: cleanText(String(candidate.creator ?? "Unknown creator")),
        platform: String(candidate.platform ?? "Web"),
        categories: Array.isArray(candidate.categories)
          ? candidate.categories.filter(
              (c: unknown): c is string => typeof c === "string",
            )
          : [],
        before:
          candidate.views_t0 == null
            ? Math.max(0, Number(candidate.views_t1) || 0)
            : Math.max(0, Number(candidate.views_t0) || 0),
        previewUrl:
          typeof candidate.preview_key === "string" &&
          /^[a-f0-9]{64}$/.test(candidate.preview_key)
            ? `/api/previews?key=${candidate.preview_key}`
            : undefined,
        image:
          typeof candidate.image === "string" &&
          /^https:\/\//.test(candidate.image)
            ? candidate.image
            : null,
        steps: Array.isArray(candidate.steps)
          ? candidate.steps
              .filter(
                (step: unknown): step is string => typeof step === "string",
              )
              .slice(0, 3)
              .map(cleanText)
          : [],
        collectedAt:
          typeof candidate.collected_at === "string"
            ? candidate.collected_at
            : null,
        baselineAt:
          typeof candidate.baseline_at === "string"
            ? candidate.baseline_at
            : null,
        publishedAt:
          typeof candidate.published_at === "string"
            ? candidate.published_at
            : null,
        aiStatus: String(candidate.ai_status ?? "unavailable"),
        after: hasBaseline ? Math.max(0, Number(candidate.views_t1) || 0) : null,
        hasBaseline,
        score: Number.isFinite(rawScore)
          ? Math.round(
              Math.max(
                0,
                Math.min(100, rawScore <= 1 ? rawScore * 100 : rawScore),
              ),
            )
          : 0,
        reason: cleanText(
          String(
            candidate.reason ?? "Check the view counts to understand this signal.",
          ),
        ),
        decision: cleanText(
          String(
            candidate.decision ??
              "Start with one small post that fits your customers.",
          ),
        ),
        url,
        predictedViews: prediction.estimated_total,
        forecast,
        prediction,
        sourceVerifiedAt: String(candidate.source_verified_at),
        categoryEvidence: candidate.category_evidence || [],
        currentViews: candidate.views_t1,
        snapshots,
        hourlyGrowthRate,
        hoursBetween,
        snapshotCount:
          snapshots.length > 0
            ? snapshots.length
            : hasBaseline
              ? 2
              : 1,
      },
    ];
  });
}
export function matchesCategory(trend: Trend, category: string) {
  return (
    category === "all" ||
    trend.categories.includes(category) ||
    (category === "food" && trend.categories.includes("cooking")) ||
    (category === "tech" &&
      trend.categories.some((c) => ["tech", "saas", "devtools"].includes(c)))
  );
}
export function matchesCategories(trend: Trend, selectedCategories: string[]) {
  return (
    selectedCategories.every((category) => matchesCategory(trend, category)) &&
    sharesActivityFrame(trend.categoryEvidence, selectedCategories)
  );
}
export function topic(trend: Trend) {
  return (
    categories.find(
      (cat) => cat.id !== "all" && matchesCategory(trend, cat.id),
    ) ?? {
      id: "tech",
      label: "Tech & AI",
    }
  );
}
export function growth(trend: Trend) {
  return trend.hasBaseline &&
    trend.after !== null &&
    trend.before !== null &&
    trend.before > 0
    ? Math.round(((trend.after - trend.before) / trend.before) * 100)
    : null;
}
export function formatCount(value: number | null) {
  if (value === null) return "—";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
export function starterIdea(trend: Trend, business: string) {
  const shop = business.trim() || "our shop";
  if (trend.steps.length === 3)
    return {
      hook: `Our take on ${trend.title}, from ${shop}.`,
      steps: trend.steps,
    };
  const ideas: Record<
    string,
    {
      hook: string;
      steps: string[];
    }
  > = {
    fashion: {
      hook: `The ${trend.title.toLowerCase()} look, made our way at ${shop}.`,
      steps: [
        "Show a product from your shop that fits the style.",
        "Film three ways to wear or use it.",
        "Invite customers to choose their favourite.",
      ],
    },
    food: {
      hook: `We tried ${trend.title.toLowerCase()} at ${shop}. Here is our twist.`,
      steps: [
        "Open with a close-up of the finished dish or drink.",
        "Show your ingredients and one behind-the-scenes moment.",
        "Ask customers if they would try your version.",
      ],
    },
    tech: {
      hook: `Could ${trend.title} make a day at ${shop} easier?`,
      steps: [
        "Show one everyday problem in your business.",
        "Try the idea on a small, real task.",
        "Share what worked and what you would change.",
      ],
    },
    music: {
      hook: `A little behind-the-scenes moment at ${shop}, with our take on ${trend.title.toLowerCase()}.`,
      steps: [
        "Choose audio you have permission to use commercially.",
        "Match three clips of your products or team to the beat.",
        "Finish with your shop name and an invitation to visit.",
      ],
    },
  };
  return (
    ideas[topic(trend).id] ?? {
      hook: `Our take on ${trend.title}, from the team at ${shop}.`,
      steps: [
        "Connect the topic to a product or everyday moment at your shop.",
        "Show your own example in a short video.",
        "Ask your customers what they think.",
      ],
    }
  );
}

export function cleanTrendMatterReason(
  reason: string,
  categoryEvidence?: CategoryEvidence[],
): string {
  if (!reason || typeof reason !== "string") {
    return (
      categoryEvidence?.[0]?.description ||
      "Positive visual engagement verified."
    );
  }

  const sentences = reason
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (
        /\bno\s+(other\s+)?(activities|actions|cooking|music|food|fashion|tech|dance|sports|crypto|meme|game|car|repairs|hands-on|instruments?)[^.]*?(visible|occur|seen|demonstration|found|present)\b/i.test(
          s,
        )
      ) {
        return false;
      }
      if (/\bno\s+instrument\s+playing\b/i.test(s)) return false;
      if (/\bthis\s+post\s+has\s+not\s+passed\b/i.test(s)) return false;
      if (/\bno\s+activity\s+could\s+be\b/i.test(s)) return false;
      return true;
    });

  const cleaned = sentences.join(" ").trim();
  if (cleaned.length > 15) return cleaned;

  if (categoryEvidence?.[0]?.description) {
    return categoryEvidence[0].description;
  }
  return reason;
}

export type GrowthReason = {
  id: string;
  title: string;
  detail: string;
  strength: number;
};

export function trendGrowthReasons(
  trend: Trend,
  allTrends: Trend[] = [],
): GrowthReason[] {
  const fired: GrowthReason[] = [];
  const current = trend.currentViews;
  const mainCategory = topic(trend).label;

  const hasHistory =
    trend.prediction.method === "observed_growth" &&
    trend.prediction.estimated_total !== null &&
    trend.before !== null &&
    trend.hoursBetween !== null &&
    trend.hoursBetween !== undefined &&
    trend.hoursBetween > 0;

  // Signal 1: Velocity spike
  if (hasHistory) {
    const diff = trend.currentViews - (trend.before ?? trend.currentViews);
    const hours = Math.max(1, Math.round(trend.hoursBetween!));
    const rate = trend.prediction.hourly_rate ?? (diff / hours);
    const pct =
      trend.before && trend.before > 0
        ? Math.round((diff / trend.before) * 100)
        : 0;

    if (diff > 0 || rate > 0) {
      fired.push({
        id: "velocity_spike",
        title: "Velocity spike",
        detail: `+${formatCount(diff)} views (+${pct}%) in the last ${hours}h (+${formatCount(Math.round(rate))}/hr pace)`,
        strength: Math.abs(pct) * 2 + Math.log10(Math.max(1, rate)) * 10,
      });
    }
  } else if (trend.publishedAt && trend.collectedAt) {
    const pubHours = Math.max(
      1,
      (Date.parse(trend.collectedAt) - Date.parse(trend.publishedAt)) / 3600000,
    );
    const hourly = current / pubHours;
    if (pubHours > 0 && current > 0) {
      const timeLabel =
        pubHours <= 48
          ? `${Math.round(pubHours)}h`
          : `${Math.round(pubHours / 24)} days`;
      fired.push({
        id: "velocity_spike",
        title: "Velocity spike",
        detail: `+${formatCount(current)} views generated in ${timeLabel} since publishing (+${formatCount(Math.round(hourly))}/hr pace)`,
        strength: Math.log10(Math.max(1, hourly)) * 12,
      });
    }
  }

  // Signal 2: Accelerating vs Decelerating growth
  if (hasHistory && trend.publishedAt && trend.baselineAt) {
    const pubToBaselineHours = Math.max(
      1,
      (Date.parse(trend.baselineAt) - Date.parse(trend.publishedAt)) / 3600000,
    );
    const initialRate = (trend.before ?? 0) / pubToBaselineHours;
    const recentRate = trend.prediction.hourly_rate ?? 0;

    if (initialRate > 0) {
      const paceChangePct = Math.round(
        ((recentRate - initialRate) / initialRate) * 100,
      );
      if (paceChangePct >= 15) {
        fired.push({
          id: "accelerating_growth",
          title: "Accelerating growth",
          detail: `Growth velocity accelerated from ${formatCount(Math.round(initialRate))}/hr to ${formatCount(Math.round(recentRate))}/hr (+${paceChangePct}% pace increase)`,
          strength: paceChangePct * 1.8,
        });
      } else if (paceChangePct <= -15 && recentRate >= 0) {
        fired.push({
          id: "decelerating_growth",
          title: "Decelerating growth",
          detail: `Growth velocity moderated from ${formatCount(Math.round(initialRate))}/hr to ${formatCount(Math.round(recentRate))}/hr (${paceChangePct}% pace change)`,
          strength: Math.abs(paceChangePct) * 1.2,
        });
      }
    }
  }

  // Signal 3: Engagement / performance above category median
  const peers = allTrends.filter((t) =>
    t && Array.isArray(t.categories) && matchesCategory(t, topic(trend).id),
  );
  if (peers.length >= 2) {
    const sortedScores = peers.map((p) => p.score).sort((a, b) => a - b);
    const midIdx = Math.floor(sortedScores.length / 2);
    const medianScore =
      sortedScores.length % 2 !== 0
        ? sortedScores[midIdx]
        : (sortedScores[midIdx - 1] + sortedScores[midIdx]) / 2;

    const sortedViews = peers
      .map((p) => p.currentViews)
      .sort((a, b) => a - b);
    const medianViews =
      sortedViews.length % 2 !== 0
        ? sortedViews[midIdx]
        : (sortedViews[midIdx - 1] + sortedViews[midIdx]) / 2;

    if (trend.score > medianScore && medianScore > 0) {
      const diffPct = Math.round(
        ((trend.score - medianScore) / medianScore) * 100,
      );
      if (diffPct >= 10) {
        fired.push({
          id: "engagement_above_median",
          title: "Engagement above category median",
          detail: `Performance score of ${trend.score}/100 is +${diffPct}% above the ${mainCategory} category median (${Math.round(medianScore)}/100)`,
          strength: diffPct * 1.4,
        });
      }
    } else if (trend.currentViews > medianViews && medianViews > 0) {
      const ratio = (trend.currentViews / medianViews).toFixed(1);
      if (Number(ratio) >= 1.2) {
        fired.push({
          id: "engagement_above_median",
          title: "Volume above category median",
          detail: `Current volume of ${formatCount(trend.currentViews)} views is ${ratio}x above the ${mainCategory} category median (${formatCount(medianViews)})`,
          strength: Number(ratio) * 20,
        });
      }
    }
  }

  // Signal 4: Cross-platform presence
  if (allTrends.length > 0) {
    const categoryId = topic(trend).id;
    const tiktokMatches = allTrends.filter(
      (t) => t && Array.isArray(t.categories) && t.platform === "TikTok" && matchesCategory(t, categoryId),
    );
    const instaMatches = allTrends.filter(
      (t) => t && Array.isArray(t.categories) && t.platform === "Instagram" && matchesCategory(t, categoryId),
    );
    if (tiktokMatches.length >= 1 && instaMatches.length >= 1) {
      const combinedViews = [...tiktokMatches, ...instaMatches].reduce(
        (sum, t) => sum + t.currentViews,
        0,
      );
      const totalPosts = tiktokMatches.length + instaMatches.length;
      fired.push({
        id: "cross_platform_presence",
        title: "Cross-platform presence",
        detail: `Active on both TikTok (${tiktokMatches.length}) and Instagram (${instaMatches.length}) with ${formatCount(combinedViews)} combined views across ${totalPosts} verified posts`,
        strength: Math.log10(Math.max(1, combinedViews)) * 6 + totalPosts * 3,
      });
    }
  }

  // Signal 5: 72-Hour trajectory projection (if forecast is ready)
  if (
    trend.prediction.method === "observed_growth" &&
    trend.prediction.estimated_total !== null
  ) {
    const projectedGain = trend.prediction.estimated_total - current;
    const gainPct =
      current > 0 ? Math.round((projectedGain / current) * 100) : 0;
    const rateStr = formatCount(
      Math.round(trend.prediction.hourly_rate || 0),
    );
    fired.push({
      id: "trajectory_projection",
      title: "Projected 72-hour trajectory",
      detail: `Projected +${formatCount(projectedGain)} views (+${gainPct}%) to reach ~${formatCount(trend.prediction.estimated_total)} over 3 days based on verified +${rateStr}/hr velocity`,
      strength: Math.abs(gainPct),
    });
  }

  // If collecting data and fewer than 2 signals fired, add baseline tracking bullet
  if (fired.length < 2) {
    fired.push({
      id: "tracking_baseline",
      title: "Baseline data collection",
      detail: `First observation recorded at ${formatCount(trend.currentViews)} views; awaiting next scan interval to establish velocity baseline`,
      strength: 5,
    });
  }

  fired.sort((a, b) => b.strength - a.strength);
  return fired.slice(0, Math.min(4, Math.max(2, fired.length)));
}
