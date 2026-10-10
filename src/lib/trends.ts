export type Trend = {
  id: string;
  title: string;
  creator: string;
  platform: string;
  categories: string[];
  before: number | null;
  image: string | null;
  steps: string[];
  collectedAt: string | null;
  baselineAt: string | null;
  aiStatus: string;
  after: number | null;
  hasBaseline: boolean;
  score: number;
  reason: string;
  decision: string;
  demo: boolean;
  url: string | null;
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
export function normalizeTrends(data: unknown): Trend[] {
  if (!Array.isArray(data)) throw new Error("Invalid trend data");
  return data.flatMap((item): Trend[] => {
    if (!item || typeof item !== "object" || typeof item.title !== "string")
      return [];
    const id = String(item.id ?? item.title);
    // The repository's t1–t30 records have placeholder source links.
    const demo = /^t([1-9]|[12]\d|30)$/.test(id) || !item.url;
    const rawScore = Number(item.breakout_score ?? item.score ?? 0);
    const url =
      typeof item.url === "string" && /^https?:\/\//i.test(item.url)
        ? item.url
        : null;
    const hasBaseline =
      demo ||
      (item.has_baseline !== undefined
        ? item.has_baseline === true
        : Boolean(item.baseline_at));
    return [
      {
        id,
        title: item.title,
        creator: String(item.creator ?? "Unknown creator"),
        platform: String(item.platform ?? "Web"),
        categories: Array.isArray(item.categories)
          ? item.categories.filter(
              (c: unknown): c is string => typeof c === "string",
            )
          : [],
        before:
          item.views_t0 == null
            ? Math.max(0, Number(item.views_t1) || 0)
            : Math.max(0, Number(item.views_t0) || 0),
        image:
          typeof item.image === "string" && /^https:\/\//.test(item.image)
            ? item.image
            : null,
        steps: Array.isArray(item.steps)
          ? item.steps
              .filter(
                (step: unknown): step is string => typeof step === "string",
              )
              .slice(0, 3)
          : [],
        collectedAt:
          typeof item.collected_at === "string" ? item.collected_at : null,
        baselineAt:
          typeof item.baseline_at === "string" ? item.baseline_at : null,
        aiStatus: String(item.ai_status ?? "unavailable"),
        after: hasBaseline ? Math.max(0, Number(item.views_t1) || 0) : null,
        hasBaseline,
        score: Number.isFinite(rawScore)
          ? Math.round(
              Math.max(
                0,
                Math.min(100, rawScore <= 1 ? rawScore * 100 : rawScore),
              ),
            )
          : 0,
        reason: String(
          item.reason ?? "Check the view counts to understand this signal.",
        ),
        decision: String(
          item.decision ??
            "Start with one small post that fits your customers.",
        ),
        demo,
        url: demo ? null : url,
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
  return selectedCategories.every((category) =>
    matchesCategory(trend, category),
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
