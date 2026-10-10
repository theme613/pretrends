# TrendRadar

End-to-end AI trend prediction dashboard and scraper bot network.

## Disclaimer & Notes
- This is a prototype. The unofficial scrapers (TikTokApi, instaloader, twikit) are best-effort and may break or violate platform ToS upon site changes. Production deployments require official APIs (e.g., TikTok Research API, Instagram Graph API).
- The AI Agent strictly scores and categorizes actual scraped signals; it never invents trends. Cards in the dashboard lacking a source URL are labeled as "Demo" data.
- All ASCII printing (Windows cp1252 compatibility).

## Setup
1. Copy `.env.example` to `.env` and fill out optional keys.
2. Install Python requirements: `pip install -r requirements.txt`
3. Install NPM dependencies: `npm install`
4. Run server: `npm run dev`

## Services
- Dashboard running at `http://localhost:3000`
- `POST /api/scan`: Triggers background bots and AI velocity scoring.
- `GET /api/trends`: Fetch latest trends.
