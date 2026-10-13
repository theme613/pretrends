# Pretrends

Discover verified social-video ideas, save your inspiration, and turn it into a content plan for your small business. No login is required.

## Your workspace

- **Discover:** search by title or creator, combine up to four categories, filter TikTok/Instagram, and sort by signal, growth, current views, or last check. Browse source details and edit a starter brief.
- **Saved ideas:** bookmarks and edited hooks survive reloads. Saved references remain accessible when a source expires, with a clear notice that it needs a fresh check. Create a draft from any saved idea.
- **Content planner:** create posts from a trend, a starter format, or a blank draft. Edit captions and shot lists, choose a platform and planned date, and move posts through Draft, Planned, and Published. Search, delete with undo, and export to CSV. Dates organise your plan; the app does not publish or send reminders automatically.
- **Workspace settings:** set your business name, check service configuration, and download/import JSON backups. Import keeps existing work and merges newer drafts. Changes sync between tabs on the same browser.

Your personal workspace is stored in this browser under `pretrends.workspace.v1`. It is separate from the shared server-side trend collection. Clearing browser data removes it, and it does not sync across devices. Download a backup to keep or transfer your work. Storage errors show a recovery message and leave changes available in the current tab.

The planner and editable starter formats work without service keys. Starter formats are writing templates, not live posts or measured trends.

## Setup

1. Install Node.js 22 or newer. For fresh discovery, copy `.env.example` to `.env.local` and add your Apify and Grafilab keys. On Vercel, configure `BLOB_READ_WRITE_TOKEN` too. Keep keys on the server.
2. Run `npm ci` (includes the FFmpeg binary for video frame extraction). The project explicitly allows the pinned native install scripts required by npm 12. Dependency installation and the first build need network access; Next.js downloads Inter at build time and serves it locally afterwards.
3. Run `npm run dev` and open http://localhost:3000.
4. Click **Find fresh ideas** for a batch of up to 12 verified matching posts. New results come first, then refreshed posts and saved verified matches. Fewer than 12 are shown if there are not enough eligible matches. “Load more” reveals the rest of the saved collection. Each refresh still performs at most 12 new video checks. Manual preparation remains available through `POST /api/scan` with `mode: "prepare"` for up to 250 new checks.

## How it works

- Apify collects TikTok and Instagram posts, real view counts and direct media URLs. A refresh targets 20 collected posts and rechecks up to 5 known posts per platform. Preparation collects up to 300 per platform and rechecks up to 100 known posts. Actor charge caps are $0.25/platform for refresh and $1/platform for preparation. Complete datasets are paginated before missing known posts are hidden.
- Refresh checks up to 12 new videos with at most 15 AI attempts, including retries. Preparation checks up to 250 with at most 300 attempts. Three 512px frames and a caption limited to 500 characters go to Grafilab Qwen 3.7 Flash, with 500 maximum output tokens and no reasoning. Three checks run concurrently across both platforms after a shared compatibility check. Successful checks are reused without downloads or AI when content is unchanged; uncertain results are cached for 24 hours and temporary failures for 15 minutes. Authentication, model-access and insufficient-credit errors stop new AI requests.
- Categories require visible activities. Cooking with background music does not match Music. Combined categories must share visible activity evidence in the same sampled frame.
- Only supported, source-verified posts with successful visual checks appear. Source verification expires after 24 hours. Failed rechecks override earlier success; missing search results alone never mean deleted.
- Successful platforms start processing independently. Each result is saved atomically and appears on the next poll, without waiting for the full scan. The collection index speeds up page loads; old history remains the recovery source.
- All observations are saved in ignored `data/scans/*.json` files, including observations beyond the visual-check limit. Legacy posts are hidden until reverified. Their valid view history is retained.
- After two observations at least one hour apart, a linear forecast estimates total views 72 hours after the latest observation. Frequent refreshes use the latest valid hour-old baseline; recent decreasing counts still prevent a real forecast. When a supported forecast is unavailable, cards and details show **Collecting data**. No synthetic view counts are presented as predictions.
- Video checks are limited to 25 MB and 10 minutes. Unsupported hosts, inaccessible media and uncertain classifications stay hidden. Temporary video files are cleaned up.

## Costs and limits

The MYR 80 budget is for Grafilab; Apify uses separate credits. No page view or popup triggers a paid request. API responses and saved scan summaries include timings, attempts, cache hits and returned token usage, including invalid/truncated responses. Unknown usage from failed network requests cannot be counted locally. Scans reuse content checks. Review Grafilab's actual billing before repeating large scans. There is no automatic upgrade to a more expensive model.

Sampled frames can miss activities. Availability means the source was verified recently, not that it can never be deleted. The 72-hour forecast assumes the recent viewing pace continues; it is not a trained probability or a guarantee.

Refresh scans and all Vercel scans finish within the 300-second route budget, including reserved time for visual checks and saving. Local preparation can run as background work with a 15-minute work budget. Restarting the server interrupts active scans. Local file storage requires a persistent writable disk; Vercel deployments require Blob for the shared collection.

## Checks and routes

- `npm test`, `npm run lint`, `npm run build`
- With the app running: `npm run test:ui` and `npm run test:workspace`.
- `POST /api/scan` accepts `{ mode: "refresh" | "prepare", categories: string[], platform: "all" | "TikTok" | "Instagram" }`. Mode defaults to refresh. An active scan is shared only when mode and filters match; a conflicting request returns HTTP 409 with an explanation. `GET /api/scan?id=…&since=…` reads progress/revision and returns an authoritative eligible collection when its revision changes. Progress and completion also include `batch: { ids, fresh_count, reused_count }`; IDs include the platform prefix. Batch selection enforces source freshness and shared-frame category evidence.
- `GET /api/trends` and `GET /api/categories` return only the same eligible collection.
- `GET /api/health` reports server-only service configuration as booleans with `Cache-Control: no-store`. It exposes no keys and does not call paid providers. Configured credentials are not a guarantee of provider access or available credits.

Normal polling is every two seconds, or ten seconds in a hidden tab. Returning to the tab wakes polling immediately. After 40 seconds, the UI keeps browsing available and explains that checks continue. Cached/prepared results should load quickly, but a cold scraper search is not guaranteed to finish within 40 seconds. Page loads and details never run paid checks.

Every card and available-post detail shows measured current views and either a supported 3-day prediction or a collecting-data state. Text search can narrow a refresh batch; category or platform changes return to normal collection browsing. Technical warnings, timings, and token usage remain in scan API diagnostics.

### Video preview checks

Real still images are cached under `data/previews/` (ignored by Git). New visual checks save a video frame; older posts recover a thumbnail or frame on demand, without AI or paid scraper calls. Keep this directory with the scan data when moving the local app. Missing or expired source media can still require a retry or a new source scan.

Run `npm test` for scan, storage, forecast, backup-validation, and export checks. With the app running, `npm run test:ui` checks desktop/mobile details, previews, scan recovery, and the saved-idea-to-planner journey. `npm run test:workspace` checks draft editing, dates, reload persistence, search, delete/undo, exports, backup restore, tab sync, and corrupt storage. Browser checks mock scan requests and never start paid work. Windows tests use installed Chrome or Edge automatically; elsewhere install Chromium with `npx playwright install chromium`, or set `CHROME_PATH`. Set `TEST_URL` to test another local server. Screenshots are written to ignored `test-results/`.

### Dependency review

The October 2026 audit reports a `braces` advisory through the ESLint/shadcn toolchain. The suggested automatic fix downgrades major framework tooling, so it has not been applied. Review `npm audit` when upgrading these tools; do not feed untrusted glob patterns into development commands.
