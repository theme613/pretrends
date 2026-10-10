import seedTrends from "../../data/trends.json";
import TrendExplorer from "@/components/trend-explorer";
import { normalizeTrends } from "@/lib/trends";

export default function Home() {
  return <TrendExplorer initialTrends={normalizeTrends(seedTrends)} />;
}
