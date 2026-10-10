import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import path from 'path';
import fs from 'fs';
import { processCandidate, ScrapedData, TrendCandidate } from '@/lib/agent';

export async function POST() {
  const apifyToken = process.env.APIFY_API_TOKEN;
  const allResults: ScrapedData[] = [];
  let liveScanSuccess = false;

  // 1. Run Apify Scraper if token exists
  if (apifyToken) {
    console.log("Starting live Apify scan...");
    try {
      const client = new ApifyClient({ token: apifyToken });
      
      // Using an official, fast Instagram scraper from Apify
      // We keep resultsLimit very low (2) so the Next.js API doesn't time out during the hackathon demo
      const run = await client.actor("apify/instagram-scraper").call({
        search: ["startup", "tech", "indiepop"],
        searchType: "hashtag",
        resultsLimit: 2,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      
      for (const item of items) {
        // Map Apify's raw JSON into our expected ScrapedData format
        // Simulating the "t0" (past) metric mathematically for the demo since we don't have a historical DB yet
        const currentViews = item.videoPlayCount || item.likesCount || 5000;
        const simulatedPastViews = Math.floor(currentViews / (1 + Math.random() * 5)); 

        allResults.push({
          id: item.id || Math.random().toString(),
          title: String(item.caption || "Instagram Post").substring(0, 50) + "...",
          creator: item.ownerUsername || "unknown",
          platform: "Instagram",
          url: item.url || "https://instagram.com",
          views_t0: simulatedPastViews,
          views_t1: currentViews,
          collected_at: new Date().toISOString()
        });
      }
      liveScanSuccess = true;
      console.log(`Apify returned ${allResults.length} live results.`);
    } catch (error) {
      console.error("Apify scan failed:", error);
    }
  } else {
    console.log("No APIFY_API_TOKEN found. Skipping live scrape.");
  }

  // 2. Load seed data as a baseline
  let trendsData: TrendCandidate[] = [];
  try {
    const seedPath = path.join(process.cwd(), 'data', 'trends.json');
    if (fs.existsSync(seedPath)) {
      trendsData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    }
  } catch (err) {
    console.error("Failed to load seed data", err);
  }

  // 3. Process live candidates through Qwen 3.7 AI Agent
  const enrichedCandidates: TrendCandidate[] = [];
  for (const item of allResults) {
    const processed = await processCandidate(item);
    enrichedCandidates.push(processed);
  }

  // Pick hottest category for retargeting
  const merged = [...enrichedCandidates, ...trendsData];
  const categoriesCount: Record<string, number> = {};
  merged.forEach(c => {
    c.categories.forEach(cat => {
      categoriesCount[cat] = (categoriesCount[cat] || 0) + c.score;
    });
  });
  const sortedCategories = Object.entries(categoriesCount).sort((a, b) => b[1] - a[1]);
  const nextTargetCategory = sortedCategories.length > 0 ? sortedCategories[0][0] : "general";

  // Append to timestamped scan outputs
  const scanSummary = {
    timestamp: new Date().toISOString(),
    live_scan: liveScanSuccess,
    scraped_count: enrichedCandidates.length,
    retargeting_category: nextTargetCategory,
    candidates: enrichedCandidates
  };

  try {
    const scansDir = path.join(process.cwd(), 'data', 'scans');
    if (!fs.existsSync(scansDir)) {
      fs.mkdirSync(scansDir, { recursive: true });
    }
    const timestampFile = `scan_${Date.now()}.json`;
    fs.writeFileSync(path.join(scansDir, timestampFile), JSON.stringify(scanSummary, null, 2));
  } catch (e) {
    console.error("Failed to save scan output", e);
  }

  return NextResponse.json({
    message: liveScanSuccess ? 'Live Apify scan completed' : 'Fallback scan completed (No Apify Key)',
    live_scan: liveScanSuccess,
    scraped_count: enrichedCandidates.length,
    next_target: nextTargetCategory,
    data: scanSummary
  });
}
