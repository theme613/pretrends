import { NextResponse } from 'next/server';
import { scrapeTikTokTrends } from '../../../../scrapers/tiktok';
import { scrapeInstagramTrends } from '../../../../scrapers/instagram';

export async function POST() {
  const results = { tiktok: 'failed', instagram: 'failed' };
  
  try {
    await scrapeTikTokTrends();
    results.tiktok = 'success';
  } catch (e) {
    results.tiktok = 'failed';
  }

  try {
    await scrapeInstagramTrends();
    results.instagram = 'success';
  } catch (e) {
    results.instagram = 'failed';
  }
  
  return NextResponse.json({ 
    message: 'Live scan unavailable. Using fallback demo data.', 
    details: results 
  });
}
