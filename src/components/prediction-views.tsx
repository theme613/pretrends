import { ArrowRight } from "lucide-react";
import { formatCount, type Trend } from "@/lib/trends";

export function PredictionViews({
  trend,
  compact = false,
}: {
  trend: Trend;
  compact?: boolean;
}) {
  const isCollecting =
    trend.prediction.method === "collecting_data" ||
    trend.prediction.estimated_total === null;

  return (
    <div
      className={
        compact ? "prediction-view prediction-compact" : "prediction-view"
      }
    >
      <div className="views-counts">
        <div>
          <span>Current views</span>
          <strong>{formatCount(trend.currentViews)}</strong>
        </div>
        <ArrowRight className="views-arrow" size={20} aria-hidden="true" />
        <div>
          <span>Predicted views in 3 days</span>
          {isCollecting ? (
            <strong className="collecting-data-val">Collecting data</strong>
          ) : (
            <strong>{formatCount(trend.prediction.estimated_total)}</strong>
          )}
        </div>
      </div>
      <p className="views-note">
        {isCollecting ? (
          <span className="collecting-note">
            Collecting data — check back after next scan
          </span>
        ) : (
          `Based on computed hourly growth (${trend.prediction.hourly_rate !== undefined && trend.prediction.hourly_rate !== null && trend.prediction.hourly_rate >= 0 ? "+" : ""}${formatCount(Math.round(trend.prediction.hourly_rate || 0))}/hr).`
        )}
      </p>
    </div>
  );
}

