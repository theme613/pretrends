# TrendRadar

Trend discovery and editable post briefs for small business owners.

## UI demo
Explore trends, filter by topic or platform, save ideas, and turn a trend into a post brief with your business name. No login is required. The UI uses the existing sample collection; saved ideas last for the current page session, and post briefs are editable templates.

Research, pitch, scope, and demo boundaries: [Demo plan](docs/demo-plan.md).

## Disclaimer & Notes
- This is a prototype. The unofficial scrapers (TikTokApi, instaloader, twikit) are best-effort and may break or violate platform ToS upon site changes. Production deployments require official APIs (e.g., TikTok Research API, Instagram Graph API).
- The AI Agent scores and categorizes scraped signals. Existing sample records are labelled in the UI, and their placeholder source URLs are not linked.
- All ASCII printing (Windows cp1252 compatibility).

## Setup
1. Copy `.env.example` to `.env` and fill out optional keys.
2. Install Python requirements: `pip install -r requirements.txt`
3. Install NPM dependencies: `npm install`
4. Run server: `npm run dev`

## Services
- App running at `http://localhost:3000`
- `POST /api/scan`: Triggers background bots and AI velocity scoring.
- `GET /api/trends`: Fetch latest trends.
