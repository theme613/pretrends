import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { processCandidate, ScrapedData, TrendCandidate } from '@/lib/agent';

const execAsync = util.promisify(exec);

async function runScraper(scriptName: string): Promise<ScrapedData[]> {
  const scriptPath = path.join(process.cwd(), 'scrapers', scriptName);
  try {
    const { stdout } = await execAsync(`python "${scriptPath}"`);
    return JSON.parse(stdout.trim());
  } catch (error) {
    console.error(`Scraper ${scriptName} failed:`, error);
    return [];
  }
}

export async function POST() {
  const scrapers = ['youtube.py', 'tiktok.py', 'instagram.py', 'x.py'];
  const allResults: ScrapedData[] = [];
  let liveScanSuccess = false;

  for (const script of scrapers) {
    const data = await runScraper(script);
    if (data && data.length > 0) {
      allResults.push(...data);
      liveScanSuccess = true;
    }
  }

  // Load seed data if no live results or as a baseline
  let trendsData: TrendCandidate[] = [];
  try {
    const seedPath = path.join(process.cwd(), 'data', 'trends.json');
    if (fs.existsSync(seedPath)) {
      trendsData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    }
  } catch (err) {
    console.error("Failed to load seed data", err);
  }

  // Process live candidates through AI Agent
  const enrichedCandidates: TrendCandidate[] = [];
  for (const item of allResults) {
    const processed = await processCandidate(item);
    enrichedCandidates.push(processed);
  }

  // Merge live candidates with existing trends
  const merged = [...enrichedCandidates, ...trendsData];

  // Pick hottest category for retargeting
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
    message: 'Scan completed',
    live_scan: liveScanSuccess,
    scraped_count: enrichedCandidates.length,
    next_target: nextTargetCategory,
    data: scanSummary
  });
}
