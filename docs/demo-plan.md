# TrendRadar demo

Small business owners need useful social-post ideas without hours of scrolling. TrendRadar shows recently verified videos, explains their content, and provides an editable three-step business post brief.

## Demo flow

1. Before the demo, manually call `POST /api/scan` with `mode: "prepare"`. During the demo, Find fresh ideas checks up to 12 new videos and builds a batch of 12 verified matches when available, filling gaps from verified saved posts. The result message separates fresh and saved counts. Choose one to four categories. Every selected category needs visible evidence; combined activities must appear together in the sampled frames.
2. Click a preview, title or View trend button to open details. Review the original source, verification time, current views and the 3-day prediction.
3. Explain the prediction label: supported forecasts use observations at least one hour apart; **Demo estimate** simulates 25% growth when history is insufficient. Show “Load more” for the saved collection.
4. Save an idea, add a business name, and copy an editable post brief.

No login or dashboard. Preserve the cream and purple editorial interface.

## Boundaries

No seed collection or invented post URLs. Legacy records stay hidden until source and visual checks succeed. Only posts verified within 24 hours appear. Failed, blocked or uncertain checks hide posts and report scan warnings while keeping historical observations.

Grafilab receives three small frames and a short caption, not a full video. Repeated content checks are cached. Sampling is conservative and can miss activities; the model cannot prove audio from still frames. Cooking with background music must not qualify as a music performance.

Real forecasts use actual timestamped count differences and assume the recent pace continues for 72 hours. The separately labelled demo simulation uses current views × 1.25, rounded. Never present that simulation as measured growth or an AI prediction. It is uncertain and is not a reason to spend on ads.

Validate the demo with three business owners: can they find a relevant verified video and create a useful post brief without help?

## Final verification checklist

- Automated: three-frame request structure and visual-evidence rules; forecasts and demo labels; hour-old baseline selection; 12-post selection, duplicates, shortages, filters and partial failures.
- Browser: desktop/mobile cards and popup; keyboard/focus; previews and retry; saved ideas; editable briefs and clipboard; batch reset/load more; conflicting scans and stalled requests.
- Commands: `npm test`, `npm run test:ui` (with the local app running), `npm run lint`, `npm run build`.
- Live boundaries: provider connection checks confirm access only. The final regression checks mock scans and AI responses; they do not prove a new paid scrape or model inference succeeds. No paid scan or fresh inference is part of this verification.
- Before presenting, confirm eligible saved posts remain within their 24-hour verification window. Keep `data/scans` and `data/previews` on the local machine. Bookmarks last only for the current page session.
