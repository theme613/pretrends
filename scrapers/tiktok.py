import os
import json
import sys
import datetime

def normalize(id, title, creator, platform, url, categories, views_t0, views_t1):
    return {
        "id": id,
        "title": title,
        "creator": creator,
        "platform": platform,
        "url": url,
        "categories": categories,
        "views_t0": views_t0,
        "views_t1": views_t1,
        "collected_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def scrape():
    results = []
    try:
        # TikTokApi unofficial
        results.append(normalize("tk1", "New Dance Challenge", "tiktok_star", "TikTok", "https://tiktok.com/@tiktok_star/video/1", ["dance"], 10000, 25000))
    except Exception as e:
        print(f"TikTok Scraper Error: {e}", file=sys.stderr)
    return results

if __name__ == "__main__":
    print(json.dumps(scrape()))
