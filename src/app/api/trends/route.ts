import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoriesParam = searchParams.get('categories');
  
  try {
    const filePath = path.join(process.cwd(), 'data', 'trends.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    let filteredData = data;
    if (categoriesParam) {
      const selectedCategories = categoriesParam.split(',').map(c => c.trim().toLowerCase());
      filteredData = data.filter((item: any) => {
        // Multi-select: intersection filter
        const itemCats = item.categories.map((c: string) => c.toLowerCase());
        return selectedCategories.every(sc => itemCats.includes(sc));
      });
    }
    
    // Sort descending by breakout score
    filteredData.sort((a: any, b: any) => b.breakout_score - a.breakout_score);
    
    return NextResponse.json(filteredData);
  } catch (error) {
    console.error("Error reading trends.json", error);
    return NextResponse.json({ error: 'Failed to load trends' }, { status: 500 });
  }
}
