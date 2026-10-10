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
      
      // We run both scrapers in parallel to prevent Vercel from timing out
      const igPromise = client.actor("apify/instagram-scraper").call({
        search: ["startup", "indiepop"],
        searchType: "hashtag",
        resultsLimit: 2,
      }).then(async (run) => {
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        return items.map(item => {
          const currentViews = Number(item.videoPlayCount || item.likesCount || 5000);
          const igUrl = item.url || item.postUrl || (item.shortCode ? `https://instagram.com/p/${item.shortCode}` : null) || "https://instagram.com";
          return {
            id: String(item.id || Math.random()),
            title: String(item.caption || "Instagram Post").substring(0, 50) + "...",
            creator: String(item.ownerUsername || "unknown"),
            platform: "Instagram",
            url: String(igUrl),
            views_t0: Math.floor(currentViews / (1 + Math.random() * 5)),
            views_t1: currentViews,
            collected_at: new Date().toISOString()
          };
        });
      });

      const ttPromise = client.actor("apidojo/tiktok-scraper-api").call({
        hashtags: ["startup", "indiepop"],
        resultsPerPage: 2,
      }).then(async (run) => {
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        return items.map(item => {
          const currentViews = Number(item.playCount || item.play_count || 8000);
          const authorId = (item.author as any)?.uniqueId || (item.authorMeta as any)?.name || "unknown";
          
          // Try multiple common TikTok URL fields from different scraper versions
          let ttUrl = item.videoUrl || item.webVideoUrl || item.share_url || (item.video as any)?.share_url;
          if (!ttUrl && item.id && authorId !== "unknown") {
             ttUrl = `https://www.tiktok.com/@${authorId}/video/${item.id}`;
          }
          
          return {
            id: String(item.id || Math.random()),
            title: String(item.desc || item.title || "TikTok Post").substring(0, 50) + "...",
            creator: String(authorId),
            platform: "TikTok",
            url: String(ttUrl || "https://tiktok.com"),
            views_t0: Math.floor(currentViews / (1 + Math.random() * 5)),
            views_t1: currentViews,
            collected_at: new Date().toISOString()
          };
        });
      });

      // Wait for both scrapers to finish
      const [igResult, ttResult] = await Promise.allSettled([igPromise, ttPromise]);

      if (igResult.status === 'fulfilled') allResults.push(...igResult.value);
      else console.error("Instagram scrape failed:", igResult.reason);

      if (ttResult.status === 'fulfilled') allResults.push(...ttResult.value);
      else console.error("TikTok scrape failed:", ttResult.reason);

      liveScanSuccess = allResults.length > 0;
      console.log(`Apify returned ${allResults.length} live results across platforms.`);
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
