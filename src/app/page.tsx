import TrendExplorer from "@/components/trend-explorer";
import { normalizeTrends } from "@/lib/trends";
import fs from 'fs';
import path from 'path';

export default async function Home() {
  const scansDir = path.join(process.cwd(), 'data', 'scans');
  let data = [];

  // 1. Try to load the most recent real scan
  if (fs.existsSync(scansDir)) {
    const files = fs.readdirSync(scansDir).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      files.sort((a, b) => fs.statSync(path.join(scansDir, b)).mtimeMs - fs.statSync(path.join(scansDir, a)).mtimeMs);
      const scanContent = JSON.parse(fs.readFileSync(path.join(scansDir, files[0]), 'utf8'));
      if (scanContent.candidates) data = scanContent.candidates;
    }
  }

  // 2. Fallback to seed ONLY if no scans exist
  if (data.length === 0) {
    const seedPath = path.join(process.cwd(), 'data', 'trends.json');
    if (fs.existsSync(seedPath)) {
      data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    }
  }

  data.sort((a: any, b: any) => (b.score || b.breakout_score || 0) - (a.score || a.breakout_score || 0));

  return <TrendExplorer initialTrends={normalizeTrends(data)} />;
}
