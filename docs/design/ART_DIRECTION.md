# Art Direction — FINCOPILOT `/radar`

> **Cập nhật:** Bố cục của lượt art direction thứ hai tại [RADAR_VISUAL_FIDELITY_REVIEW.md](RADAR_VISUAL_FIDELITY_REVIEW.md) thay thế composition đơn của phiên bản đầu. Tài liệu này còn lưu nguyên tắc typography, màu và semantic states.

## Direction

**Vietnamese Financial Editorial × Trust-First Workspace**

Treat Radar as a financial news reading surface with explicit source provenance, not as a KPI dashboard. The page should make the latest source-published item easy to enter, keep the rest scannable, and show crawl health without suggesting that a successful fetch verifies the content.

## Composition

- **Application frame:** retain the existing shared app shell and navigation; this task does not alter the other routes or shared navigation.
- **Desktop, 1440 px viewport:** a bounded content canvas around 1120 px. At wide widths, reserve roughly 68–72% for the feed and 24–28% for a source-status rail, separated by whitespace and one vertical rule. Keep the rail narrow enough to read as context, not a competing dashboard.
- **Masthead:** breadcrumb/section label, one 32–36 px Vietnamese page title, a short sentence describing provenance. Remove the source-count KPI.
- **Feed hierarchy:** API's first dated item (the API orders `publishedAt` descending, nulls last) is the lead, with a larger title and its real category/source/publication metadata. Secondary items are compact rows separated by rules. Do not add images: the article list contract has no image field.
- **Mobile, 390 px viewport:** one column. Keep the feed and filters first; place the source-status list after the feed, where it remains available without pushing the lead below an oversized rail. No horizontal scrolling.
- **Risk alerts:** retain their own tab. Mark verification state in text and use an amber/red edge only as a supporting signal. Evidence and indicators remain on the existing detail route.

## Reference crops and decisions

| Decision | Reference crop/description | FINCOPILOT treatment |
|---|---|---|
| Lead and secondary rhythm | Bace supplied screenshot: broad featured story area followed by compact article rows; narrow right curated column. | Lead article plus ruled compact rows; right rail shows actual crawl source state. No photos or “curated” claim. |
| Source proximity | Goldman supplied screenshot: source/author/time line immediately above or beside research headline, preserved in phone view. | Source link and published time adjacent to each headline; crawl/first-seen time is labeled separately. |
| Typographic focus | Aura preview: large type creates a clear entry point, then smaller body and panel details. | Use a 30–34 px lead title and 19–22 px secondary headlines; retain Be Vietnam Pro for Vietnamese glyph consistency. |
| Loan comparison | Credible public materials and Nrich concept are references for the later Advisor review only; Nrich visual fidelity was insufficiently inspected. | No change to `/survey` in this Radar task. |

## Typography and semantic color

Use existing design-system fonts and colors; no global token changes are required for this screen.

| Role | Target |
|---|---|
| Page title | 32–36 px desktop; 28–32 px mobile; Be Vietnam Pro semibold |
| Lead article | 28–32 px desktop; 23–27 px mobile; line-height around 1.3 |
| Secondary headline | 18–21 px; line-height around 1.4 |
| Body / controls | 14–16 px; comfortable Vietnamese line-height |
| Source and time | 12–13 px, muted but legible; never below 12 px |
| Technical time/numeric labels | Existing JetBrains Mono only where tabular alignment helps |
| Ink / canvas / rule | Existing `#13221C`, `#F6F7F4`, `#DCE4DE` |
| Brand / verified / caution / danger | Existing green, verified, amber and red semantic tokens; always pair color with text |

## Interaction and responsive behavior

- Headline is the internal detail link. Original publication URL remains a separate external link in source metadata; avoid a redundant “read at” row.
- Search and topic controls remain labeled and keyboard-operable with visible focus.
- Keep loading, error/retry, empty results and source-unavailable messages. Do not fill sparse or failed states with invented articles.
- Use a lead only when a real item is present. If the first article has no `publishedAt`, do not label it “newest”; the API still places undated items last.
- An error from a source is crawl status, not proof that stored articles are new or false. Preserve source and publication timestamps.
- Support a growing list through the existing API response; keep layout single-column and content-driven for 1, 5, 20 or 100 results.

## Review criteria

1. The first dated article is visibly distinct and the next items scan faster.
2. Source name, original URL, publication time and first-seen time remain distinguishable.
3. The source rail communicates status without charts, fabricated freshness scores or KPI decoration.
4. At 390 px, filters and article text fit without horizontal overflow or loss of controls.
5. Search, topic selection, tab selection, detail links and source links retain their existing semantics.

The design is a direction and hypothesis validated against rendered screenshots, not a claim of user research or final production polish.

## Screenshot fixture note

Before/after captures use isolated Playwright network fixtures so the same layout can be rendered without a running backend. Article titles, source states and `example.test` links are synthetic screenshot data, not current news, real source links or production API responses. The fixtures are created in the capture script only and are not added to the application or backend.
