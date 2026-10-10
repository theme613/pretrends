# TrendRadar

Verified social-video ideas for small business owners. No login is required.

## Setup

1. Copy `.env.example` to `.env.local` and add your Apify and Grafilab keys.
2. Run `npm install` (includes the FFmpeg binary for video frame extraction).
3. Run `npm run dev` and open http://localhost:3000.
4. Click **Find fresh ideas** for a batch of up to 12 verified matching posts. New results come first, then refreshed posts and saved verified matches. Fewer than 12 are shown if there are not enough eligible matches. “Load more” reveals the rest of the saved collection. Each refresh still performs at most 12 new video checks. Manual preparation remains available through `POST /api/scan` with `mode: "prepare"` for up to 250 new checks.

## How it works

- Apify collects TikTok and Instagram posts, real view counts and direct media URLs. A refresh targets 20 collected posts and rechecks up to 5 known posts per platform. Preparation collects up to 300 per platform and rechecks up to 100 known posts. Actor charge caps are $0.25/platform for refresh and $1/platform for preparation. Complete datasets are paginated before missing known posts are hidden.
- Refresh checks up to 12 new videos with at most 15 AI attempts, including retries. Preparation checks up to 250 with at most 300 attempts. Three 512px frames and a caption limited to 500 characters go to Grafilab Qwen 3.7 Flash, with 500 maximum output tokens and no reasoning. Three checks run concurrently across both platforms after a shared compatibility check. Successful checks are reused without downloads or AI when content is unchanged; uncertain results are cached for 24 hours and temporary failures for 15 minutes. Authentication, model-access and insufficient-credit errors stop new AI requests.
- Categories require visible activities. Cooking with background music does not match Music. Combined categories must share visible activity evidence in the same sampled frame.
- Only supported, source-verified posts with successful visual checks appear. Source verification expires after 24 hours. Failed rechecks override earlier success; missing search results alone never mean deleted.
- Successful platforms start processing independently. Each result is saved atomically and appears on the next poll, without waiting for the full scan. The collection index speeds up page loads; old history remains the recovery source.
- All observations are saved in ignored `data/scans/*.json` files, including observations beyond the visual-check limit. Legacy posts are hidden until reverified. Their valid view history is retained.
- After two observations at least one hour apart, a linear forecast estimates total views 72 hours after the latest observation. Frequent refreshes use the latest valid hour-old baseline; recent decreasing counts still prevent a real forecast. When a real forecast is unavailable, cards and details show a clearly labelled **Demo estimate**: current views × 1.25, rounded. This simulates 25% growth over three days; it is not an AI prediction and never changes measured counts, growth, category evidence or ranking.
- Video checks are limited to 25 MB and 10 minutes. Unsupported hosts, inaccessible media and uncertain classifications stay hidden. Temporary video files are cleaned up.

## Costs and limits

The MYR 80 budget is for Grafilab; Apify uses separate credits. No page view or popup triggers a paid request. API responses and saved scan summaries include timings, attempts, cache hits and returned token usage, including invalid/truncated responses. Unknown usage from failed network requests cannot be counted locally. Scans reuse content checks. Review Grafilab's actual billing before repeating large scans. There is no automatic upgrade to a more expensive model.

Sampled frames can miss activities. Availability means the source was verified recently, not that it can never be deleted. The 72-hour forecast assumes the recent viewing pace continues; it is not a trained probability or a guarantee.

The background scan is local-process work with a 15-minute route limit. The visual stage stops starting new checks before that limit and saves partial observations. Restarting the server interrupts active scans. File storage requires a persistent writable disk; it is not shared across serverless instances.

## Checks and routes

- `npm test`, `npm run lint`, `npm run build`
- `POST /api/scan` accepts `{ mode: "refresh" | "prepare", categories: string[], platform: "all" | "TikTok" | "Instagram" }`. Mode defaults to refresh. An active scan is shared only when mode and filters match; a conflicting request returns HTTP 409 with an explanation. `GET /api/scan?id=…&since=…` reads progress/revision and returns an authoritative eligible collection when its revision changes. Progress and completion also include `batch: { ids, fresh_count, reused_count }`; IDs include the platform prefix. Batch selection enforces source freshness and shared-frame category evidence.
- `GET /api/trends` and `GET /api/categories` return only the same eligible collection.
- Bookmarks last for the current page session; post briefs are editable.

Normal polling is every two seconds, or ten seconds in a hidden tab. Returning to the tab wakes polling immediately. After 40 seconds, the UI keeps browsing available and explains that checks continue. Cached/prepared results should load quickly, but a cold scraper search is not guaranteed to finish within 40 seconds. Page loads and details never run paid checks.

Every card and available-post detail shows current views and a 3-day prediction. Supported growth forecasts and the 25% demo simulation have distinct labels and explanations. Text search can narrow a refresh batch; category or platform changes return to normal collection browsing. Technical warnings, timings, and token usage remain in scan API diagnostics.

### Video preview checks

Real still images are cached under `data/previews/` (ignored by Git). New visual checks save a video frame; older posts recover a thumbnail or frame on demand, without AI or paid scraper calls. Keep this directory with the scan data when moving the local app. Missing or expired source media can still require a retry or a new source scan.

Run `npm test` for storage and recovery checks. With the app running and saved eligible posts available, run `npm run test:ui` for desktop/mobile popup, preview and scan regression checks. These browser checks mock scan requests and never start paid work. Install Chromium with `npx playwright install chromium`, or set `CHROME_PATH` to an installed Chrome executable. The stalled-request checks take about one minute.
