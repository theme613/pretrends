# TrendRadar

Verified social-video ideas for small business owners. No login is required.

## Setup

1. Copy `.env.example` to `.env.local` and add your Apify and Grafilab keys.
2. Run `npm install` (includes the FFmpeg binary for video frame extraction).
3. Run `npm run dev` and open http://localhost:3000.
4. Click **Find fresh trends** to run a scan. Refresh ideas only reads saved results.

## How it works

- Apify collects TikTok and Instagram posts, real view counts and direct media URLs. A scan rechecks up to 100 known posts per selected platform and discovers more posts.
- Up to 250 unique videos per scan receive visual checks. Three 512px frames and a short caption go to Grafilab Qwen 3.7 Flash, with 650 maximum output tokens and no reasoning. Three checks run concurrently after a small compatibility check. Successful checks are reused when the content fingerprint is unchanged.
- Categories require visible activities. Cooking with background music does not match Music. Combined categories must share visible activity evidence in the same sampled frame.
- Only supported, source-verified posts with successful visual checks appear. Source verification expires after 24 hours. Failed rechecks override earlier success; missing search results alone never mean deleted.
- All observations are saved in ignored `data/scans/*.json` files, including observations beyond the visual-check limit. Legacy posts are hidden until reverified. Their valid view history is retained.
- After two observations at least one hour apart, a linear forecast estimates total views 72 hours after the latest observation. Forecasts are separate from measured counts. Decreasing counts or invalid timestamps produce no estimate.
- Video checks are limited to 25 MB and 10 minutes. Unsupported hosts, inaccessible media and uncertain classifications stay hidden. Temporary video files are cleaned up.

## Costs and limits

The MYR 80 budget is for Grafilab; Apify uses separate credits. No page view or popup triggers a paid request. API responses include token usage, and scans reuse content checks. Review Grafilab's actual billing before repeating large scans. There is no automatic upgrade to a more expensive model.

Sampled frames can miss activities. Availability means the source was verified recently, not that it can never be deleted. The 72-hour forecast assumes the recent viewing pace continues; it is not a trained probability or a guarantee.

The background scan is local-process work with a 15-minute route limit. The visual stage stops starting new checks before that limit and saves partial observations. Restarting the server interrupts active scans. File storage requires a persistent writable disk; it is not shared across serverless instances.

## Checks and routes

- `npm test`, `npm run lint`, `npm run build`
- `POST /api/scan` starts a background scan; `GET /api/scan?id=…` reads progress, warnings and returned token usage.
- `GET /api/trends` and `GET /api/categories` return only the same eligible collection.
- Bookmarks last for the current page session; post briefs are editable.
