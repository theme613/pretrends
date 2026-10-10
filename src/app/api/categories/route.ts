import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET() {
  try {
    const seedPath = path.join(process.cwd(), 'data', 'trends.json');
    let trendsData = [];
    if (fs.existsSync(seedPath)) {
      trendsData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    }

    const counts: Record<string, number> = {};
    trendsData.forEach((item: any) => {
      if (item.categories) {
        item.categories.forEach((cat: string) => {
          counts[cat] = (counts[cat] || 0) + 1;
        });
      }
    });

    const result = Object.entries(counts).map(([name, count]) => ({ name, count }));
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch categories", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
