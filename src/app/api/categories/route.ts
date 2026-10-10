import { NextResponse } from "next/server";
import { latestTrends } from "@/lib/scan-store";

export async function GET() {
  try {
    const counts: Record<string, number> = {};
    for (const post of await latestTrends()) {
      for (const category of new Set(post.categories))
        counts[category] = (counts[category] || 0) + 1;
    }
    return NextResponse.json(
      Object.entries(counts).map(([name, count]) => ({ name, count })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read verified categories." },
      { status: 500 },
    );
  }
}
