import { NextResponse } from "next/server";
import { latestTrends } from "@/lib/scan-store";
import { matchesCategories, normalizeTrends } from "@/lib/trends";

export async function GET(request: Request) {
  try {
    const data = await latestTrends();
    const categories =
      new URL(request.url).searchParams
        .get("categories")
        ?.split(",")
        .filter(Boolean) || [];
    const ids = new Set(
      normalizeTrends(data)
        .filter((trend) => matchesCategories(trend, categories))
        .map((trend) => trend.id),
    );
    return NextResponse.json(
      data.filter((item) => ids.has(`${item.platform}:${item.id}`)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read saved trends." },
      { status: 500 },
    );
  }
}
