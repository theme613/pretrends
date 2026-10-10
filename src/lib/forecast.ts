export type Forecast = {
  method: "linear-72h-v1";
  status:
    | "ready"
    | "first_observation"
    | "invalid_observations"
    | "too_soon"
    | "decreasing_views";
  estimated_total: number | null;
  views_per_hour: number | null;
  calculated_at: string;
  target_at: string | null;
};

export function calculateForecast(post: {
  views_t0: number | null;
  views_t1: number;
  has_baseline?: boolean;
  baseline_at?: string;
  collected_at: string;
}): Forecast {
  const result: Forecast = {
    method: "linear-72h-v1",
    status: "first_observation",
    estimated_total: null,
    views_per_hour: null,
    calculated_at: post.collected_at,
    target_at: null,
  };
  if (!post.has_baseline) return result;
  const start = Date.parse(post.baseline_at || "");
  const end = Date.parse(post.collected_at);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isSafeInteger(post.views_t0) ||
    post.views_t0 === null ||
    post.views_t0 < 0 ||
    !Number.isSafeInteger(post.views_t1) ||
    post.views_t1 < 0
  ) {
    return { ...result, status: "invalid_observations" };
  }
  if (post.views_t1 < post.views_t0)
    return { ...result, status: "decreasing_views" };
  const hours = (end - start) / 3600000;
  if (hours < 1) return { ...result, status: "too_soon" };
  const rate = (post.views_t1 - post.views_t0) / hours;
  const estimate = Math.max(0, Math.round(post.views_t1 + rate * 72));
  if (
    !Number.isSafeInteger(estimate) ||
    !Number.isFinite(new Date(end + 72 * 3600000).getTime())
  )
    return { ...result, status: "invalid_observations" };
  return {
    ...result,
    status: "ready",
    estimated_total: estimate,
    views_per_hour: rate,
    target_at: new Date(end + 72 * 3600000).toISOString(),
  };
}

export function forecastMessage(status: Forecast["status"]) {
  return {
    ready:
      "This estimate assumes the recent pace continues. Actual views may differ.",
    first_observation: "Collecting data — check back after next scan",
    too_soon:
      "Collecting data — check back after next scan",
    invalid_observations:
      "Collecting data — check back after next scan",
    decreasing_views:
      "The recorded count decreased, so a growth estimate is unavailable.",
  }[status];
}

export type PredictionDisplay = {
  method: "observed_growth" | "collecting_data";
  estimated_total: number | null;
  hourly_rate?: number | null;
  hours_between?: number | null;
  diff?: number | null;
  percent?: number | null;
  status_message?: string;
};

export function predictionDisplay(
  currentViews: number,
  forecast: Forecast,
  hoursBetween?: number | null,
): PredictionDisplay {
  if (
    forecast.status === "ready" &&
    forecast.estimated_total !== null &&
    Number.isSafeInteger(forecast.estimated_total) &&
    forecast.estimated_total >= 0
  ) {
    const diff = forecast.estimated_total - currentViews;
    const percent =
      currentViews > 0 ? Math.round((diff / currentViews) * 100) : 0;
    return {
      method: "observed_growth",
      estimated_total: forecast.estimated_total,
      hourly_rate: forecast.views_per_hour,
      hours_between: hoursBetween ?? (forecast.views_per_hour !== null ? 72 : null),
      diff,
      percent,
    };
  }

  return {
    method: "collecting_data",
    estimated_total: null,
    status_message: "Collecting data — check back after next scan",
  };
}
