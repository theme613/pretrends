import type { TrendCandidate } from "./agent";
import { isEligiblePost, sharesActivityFrame } from "./post-policy";

export type RefreshBatch = { ids: string[]; fresh_count: number; reused_count: number };
export type BatchFilters = { categories: string[]; platform: string };
export function sameBatchFilters(a: BatchFilters, b: BatchFilters) {
  return a.platform === b.platform && [...a.categories].sort().join(",") === [...b.categories].sort().join(",");
}
export function selectRefreshBatch(
  posts: TrendCandidate[], filters: BatchFilters,
  freshIds: string[] = [], refreshedIds: string[] = [], now = Date.now(),
): RefreshBatch {
  const fresh = new Set(freshIds), refreshed = new Set(refreshedIds);
  const identity = (post: TrendCandidate) => `${post.platform}:${post.id}`;
  const priority = (post: TrendCandidate) => fresh.has(identity(post)) ? 0 : refreshed.has(identity(post)) ? 1 : 2;
  const unique = [...new Map(posts.map((post) => [identity(post), post])).values()];
  const selected = unique.filter((post) =>
    isEligiblePost(post, now) &&
    (filters.platform === "all" || post.platform === filters.platform) &&
    filters.categories.every((category) => post.categories.includes(category)) &&
    sharesActivityFrame(post.category_evidence || [], filters.categories),
  ).sort((a, b) => priority(a) - priority(b) || b.score - a.score || identity(a).localeCompare(identity(b))).slice(0, 12);
  const ids = selected.map(identity), fresh_count = ids.filter((id) => fresh.has(id)).length;
  return { ids, fresh_count, reused_count: ids.length - fresh_count };
}
