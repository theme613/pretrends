import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoriesParam = searchParams.get('categories');
  
  try {
    const scansDir = path.join(process.cwd(), 'data', 'scans');
    let data = [];

    // Try to load the most recent real scan
    if (fs.existsSync(scansDir)) {
      const files = fs.readdirSync(scansDir).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        // Sort files by timestamp (newest first)
        files.sort((a, b) => fs.statSync(path.join(scansDir, b)).mtimeMs - fs.statSync(path.join(scansDir, a)).mtimeMs);
        const latestScanPath = path.join(scansDir, files[0]);
        const scanContent = JSON.parse(fs.readFileSync(latestScanPath, 'utf8'));
        // Extract just the candidates from the scan summary
        if (scanContent.candidates && scanContent.candidates.length > 0) {
          data = scanContent.candidates;
        }
      }
    }

    // Fallback to hardcoded seed data ONLY if no real scans exist
    if (data.length === 0) {
      const filePath = path.join(process.cwd(), 'data', 'trends.json');
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }
    
    let filteredData = data;
    if (categoriesParam) {
      const selectedCategories = categoriesParam.split(',').map(c => c.trim().toLowerCase());
      filteredData = data.filter((item: any) => {
        const itemCats = item.categories.map((c: string) => c.toLowerCase());
        return selectedCategories.every(sc => itemCats.includes(sc));
      });
    }
    
    // Sort descending by score
    filteredData.sort((a: any, b: any) => (b.score || b.breakout_score || 0) - (a.score || a.breakout_score || 0));
    
    return NextResponse.json(filteredData);
  } catch (error) {
    console.error("Error reading trends", error);
    return NextResponse.json({ error: 'Failed to load trends' }, { status: 500 });
  }
}
