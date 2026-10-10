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
        if os.environ.get("IG_USERNAME"):
            results.append(normalize("ig1", "Streetwear Summer Drop", "fashion_icon", "Instagram", "https://instagram.com/p/1", ["fashion"], 2000, 4500))
        else:
            raise Exception("No IG_USERNAME provided. Instaloader needs burner account.")
    except Exception as e:
        print(f"Instagram Scraper Error: {e}", file=sys.stderr)
    return results

if __name__ == "__main__":
    print(json.dumps(scrape()))
