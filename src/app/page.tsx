import { Suspense } from "react";
import { connection } from "next/server";
import TrendExplorer from "@/components/trend-explorer";
import { normalizeTrends } from "@/lib/trends";
import { latestTrends } from "@/lib/scan-store";

async function CurrentTrends() {
  await connection();
  return (
    <TrendExplorer initialTrends={normalizeTrends(await latestTrends())} />
  );
}
export default function Home() {
  return (
    <Suspense fallback={<p style={{ padding: 32 }}>Loading your ideas…</p>}>
      <CurrentTrends />
    </Suspense>
  );
}
