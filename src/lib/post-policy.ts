export const CONTENT_CHECK_VERSION = "visual-v3";
export const SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type CategoryEvidence = {
  category: string;
  activity: string;
  frames: number[];
  description: string;
  active: true;
};
export const activities: Record<string, string[]> = {
  food: ["preparing_food", "cooking_food"],
  music: ["singing", "playing_instrument"],
  fashion: ["styling_clothes", "showing_fashion"],
  tech: ["demonstrating_technology"],
  game: ["playing_video_game"],
  meme: ["performing_comedy", "showing_meme"],
  sports: ["exercising", "playing_sport"],
  car: ["showing_car", "working_on_car"],
  crypto: ["explaining_crypto"],
  dance: ["dancing"],
};
function describesVisibleAction(category: string, description: string) {
  if (
    /\b(?:no visible|not visible|not clearly|uncertain|cannot see)\b/i.test(
      description,
    )
  )
    return false;
  if (category === "food")
    return /\b(?:chop(?:ping|s)?|slic(?:e|ing|es)|mix(?:ing|es)?|stir(?:ring|s)?|knead(?:ing|s)?|pour(?:ing|s)?|peel(?:ing|s)?|wash(?:ing|es)?|fry(?:ing|ies)?|boil(?:ing|s)?|bak(?:e|ing|es)|grill(?:ing|s)?|whisk(?:ing|s)?|cut(?:ting|s)?|spread(?:ing|s)?|add(?:ing|s)? ingredients|rolling dough)\b/i.test(
      description,
    );
  if (category === "music")
    return /\b(?:sing(?:ing|s)?|strum(?:ming|s)?|pluck(?:ing|s)?|playing (?:an? )?(?:instrument|guitar|piano|keyboard|violin|drum|saxophone|flute|trumpet)|pressing piano keys)\b/i.test(
      description,
    );
  return true;
}

export function validCategoryEvidence(
  value: unknown,
): value is CategoryEvidence & { confident?: boolean } {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.active === true &&
    typeof entry.category === "string" &&
    typeof entry.activity === "string" &&
    Boolean(activities[entry.category]?.includes(entry.activity)) &&
    Array.isArray(entry.frames) &&
    entry.frames.length > 0 &&
    entry.frames.every(
      (frame) => Number.isInteger(frame) && frame >= 1 && frame <= 3,
    ) &&
    typeof entry.description === "string" &&
    Boolean(entry.description.trim()) &&
    describesVisibleAction(entry.category, entry.description)
  );
}

export type SourceStatus = "available" | "unavailable" | "unverified";
export type Verification = {
  id: string;
  platform: string;
  status: SourceStatus;
  checked_at: string;
  run_id?: string;
};

// A URL is evidence only when its platform and post identity agree.
export function validSourceIdentity(
  platform: string,
  id: string,
  url: string,
  shortCode?: string,
) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      return false;
    if (platform === "TikTok") {
      return (
        ["tiktok.com", "www.tiktok.com"].includes(parsed.hostname) &&
        /^\d+$/.test(id) &&
        parsed.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1] === id
      );
    }
    if (platform === "Instagram") {
      const code = parsed.pathname.match(
        /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/,
      )?.[1];
      return (
        ["instagram.com", "www.instagram.com"].includes(parsed.hostname) &&
        Boolean(code && code === (shortCode || id))
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function sharesActivityFrame(
  evidence: CategoryEvidence[],
  selected: string[],
) {
  if (selected.length < 2) return true;
  return [1, 2, 3].some((frame) =>
    selected.every((category) =>
      evidence.some(
        (entry) => entry.category === category && entry.frames.includes(frame),
      ),
    ),
  );
}

export function isEligiblePost(
  post: {
    id: string;
    platform: string;
    url: string;
    short_code?: string;
    views_t1: number;
    source_status?: SourceStatus;
    source_verified_at?: string;
    source_run_id?: string;
    content_check_version?: string;
    content_status?: string;
    category_evidence?: CategoryEvidence[];
    categories?: string[];
  },
  now = Date.now(),
) {
  const verified = Date.parse(post.source_verified_at || "");
  return (
    post.source_status === "available" &&
    Boolean(post.source_run_id) &&
    Number.isFinite(verified) &&
    verified <= now &&
    now - verified <= SOURCE_MAX_AGE_MS &&
    validSourceIdentity(post.platform, post.id, post.url, post.short_code) &&
    Number.isSafeInteger(post.views_t1) &&
    post.views_t1 >= 0 &&
    post.content_status === "verified" &&
    post.content_check_version === CONTENT_CHECK_VERSION &&
    Boolean(
      Array.isArray(post.category_evidence) &&
        post.category_evidence.every(validCategoryEvidence) &&
        Array.isArray(post.categories) &&
        post.categories.length &&
        post.categories.every((category) =>
          post.category_evidence?.some(
            (entry) => entry.category === category && entry.frames.length > 0,
          ),
        ),
    )
  );
}
