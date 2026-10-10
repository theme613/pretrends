import { ArrowRight } from "lucide-react";
import { formatCount, type Trend } from "@/lib/trends";

export function PredictionViews({ trend, compact = false }: { trend: Trend; compact?: boolean }) {
  const demo = trend.prediction.method === "demo_growth";
  return <div className={compact ? "prediction-view prediction-compact" : "prediction-view"}>
    <div className="views-counts">
      <div><span>Current views</span><strong>{formatCount(trend.currentViews)}</strong></div>
      <ArrowRight className="views-arrow" size={20} aria-hidden="true" />
      <div><span>Predicted views in 3 days</span><strong>{formatCount(trend.prediction.estimated_total)}</strong></div>
    </div>
    <p className="views-note">
      {demo ? <><span className="demo-estimate">Demo estimate</span> Simulates 25% growth over 3 days.</> : "Assumes the recent growth continues."}
    </p>
  </div>;
}
