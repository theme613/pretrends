import { Suspense } from "react";
import { connection } from "next/server";
import TrendExplorer from "@/components/trend-explorer";
import { normalizeTrends } from "@/lib/trends";
import { latestTrends } from "@/lib/scan-store";

async function CurrentTrends() {
  await connection();
  let trends: ReturnType<typeof normalizeTrends> = [];
  try {
    const raw = await latestTrends();
    trends = normalizeTrends(raw);
  } catch (error) {
    console.error("Failed to load initial trends on server:", error);
  }
  return <TrendExplorer initialTrends={trends} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p style={{ padding: 32 }}>Loading your ideas…</p>}>
      <CurrentTrends />
    </Suspense>
  );
}
