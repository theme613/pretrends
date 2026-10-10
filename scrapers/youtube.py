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
        api_key = os.environ.get("YOUTUBE_API_KEY")
        if api_key:
            # Fake actual API call for demo since this is a prototype
            results.append(normalize("yt1", "Building Agents in Rust", "CodeMax", "YouTube", "https://youtube.com/watch?v=yt1", ["tech", "devtools"], 1000, 5000))
        else:
            # Fallback
            results.append(normalize("yt_fallback", "YT API Key Missing - Fallback Video", "DemoBot", "YouTube", "https://youtube.com", ["demo"], 500, 600))
    except Exception as e:
        print(f"YouTube Scraper Error: {e}", file=sys.stderr)
    return results

if __name__ == "__main__":
    print(json.dumps(scrape()))
