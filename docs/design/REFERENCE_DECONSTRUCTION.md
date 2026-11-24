# Reference Deconstruction — FINCOPILOT Radar

**Scope:** Visual analysis supporting `/radar` only. References were used for principles, not copied as finished layouts or assets. The supplied design brief and source images live in the sibling `Momo/docs/design` folder; the application is in this repository.

## Access and evidence

| Reference | Access result |
|---|---|
| Bace News Dashboard | The supplied JPG in `Momo/docs/design/references` was opened and visually inspected. |
| Goldman Sachs MarketFeed | The supplied JPG in `Momo/docs/design/references` was opened and visually inspected. |
| Aura Editorial | The public Dribbble page did not render in the browser, but its linked preview image loaded and was visually inspected. Treat it as a visual concept, not verified product UX. |
| Credible | The public site is reachable and its loan-comparison image was identified through the search result. Its full comparison flow was not visually inspected in this Radar task; it is out of the `/radar` implementation scope. |
| Nrich | The Dribbble page and preview image URL were reachable, but the image was not visually inspected at sufficient fidelity in this environment. No visual claim from it informs the Radar implementation. |
| ABBYY / Resistant AI | Not visually reviewed because no Forensic screen is being redesigned in this task. |

## Reference-to-product translation

| Reference and visible decision | Why it works | Translation to FINCOPILOT | Do not copy |
|---|---|---|---|
| **Bace — asymmetric editorial feed.** The supplied desktop composition combines a broad central reading area, a narrower curated column, topic controls, a pair of prominent story treatments and more compact story rows below. A separate app navigation rail frames the content. Its story imagery is large and occupies roughly half the main feed width; metadata and headline sit over or beside it. The mobile composition moves to a single reading column. | A reader can distinguish lead content from secondary items while retaining a way to browse context and filters. The hierarchy comes from scale and placement rather than a repeated grid of equal cards. | Keep the existing application navigation. Within Radar use one prominent lead item from the API's publication-time ordering, compact subsequent rows, and a narrow source-status rail. Use category, source, published time and first-seen time as real editorial metadata. As no article-image field exists in the current contract, use typography and rules instead of images. | Orange backdrop, author portraits, image overlays, subscription banner, creator branding, and a pixel-for-pixel recreation. Do not invent images to imitate the reference. |
| **Goldman Sachs MarketFeed — source-first reading hierarchy.** The supplied screenshot shows a dark institutional header, a restrained white research canvas, a small source/author/time line before the headline, and supporting commentary or chart content below. The phone view retains source, date/time, filters and a readable excerpt in one column. | Provenance is adjacent to the claim it qualifies; desktop density does not depend on hiding the source, and mobile keeps the same reading order. | Keep source links and publication timestamps directly alongside each article title; show first-seen separately. Preserve facts in the source and AI interpretation as separate on the detail route. On the feed, link to the internal article detail and expose original source links in metadata. | Goldman Sachs / Marquee branding, market charts not returned by the API, implied institutional endorsement, or research-style conclusions the source does not make. |
| **Aura Editorial — typographic contrast and whitespace.** The inspected preview uses a large editorial serif headline, sparse copy, warm neutral canvas, restrained terracotta accent and staggered content panels. It is a marketing-page concept rather than a dense application screen. | Scale and whitespace make the reading entry point clear, while a restrained accent creates a memorable focal point. | Borrow the strong lead-to-secondary type scale and deliberate whitespace. Keep Be Vietnam Pro for Vietnamese readability and existing forest/ink tokens; use a subtle label and rule rather than a display serif, terracotta brand shift or oversized landing-page headline. | Giant landing-page typography, decorative bento panels, investment claims, and the concept's tilted/staggered mockup composition. |
| **Credible — comparison clarity (reference for later Loan Advisor work).** Search-visible product materials emphasize step progression and comparison criteria; the public landing page promotes personalized, prequalified lender offers. | Comparison is decision-oriented only when payment, APR, term, fees and eligibility context are visible together. | No Radar UI change. For a later Loan Advisor review, compare only deterministic user-entered scenarios or sourced offers; do not imply real lender matching or prequalification. | Lender offers, “best match” claims, hard/soft credit-check claims or integrations that FINCOPILOT does not have. |
| **Nrich — compact comparison concept (reference for later Loan Advisor work).** The search result describes a left-side product filter and loan list with compact attributes; the actual image was not inspected at sufficient fidelity. | Potentially useful as a hypothesis for keeping filters separate from comparable rows. | No Radar UI change. Revisit only when the team reviews Loan Advisor and can inspect the reference screenshot. | Any detail inferred from the inaccessible-at-fidelity image; marketplace application actions or offers. |
| **ABBYY / Resistant AI — evidence review (conditional).** Not visually reviewed for this task. | Not assessed. | No Radar UI change. Revisit if Forensic enters an approved redesign scope and a visual reference can be inspected. | Any unverified claim about its specific layout or workflow. |

## Observed current Radar problems

1. Every article uses essentially the same headline scale and vertical treatment, so a list of five reads as five competing lead stories.
2. A separate “Đọc tại …” action repeats the source link already represented by the article metadata and consumes another line per item.
3. The masthead's source count behaves like a dashboard KPI; it does not tell a reader whether an article is useful or fresh.
4. The source rail has genuine provenance value, but its timestamps wrap into multiple lines and its explanatory copy repeats information already available in article metadata.
5. The mobile view is structurally sound with no horizontal overflow, but equal-height article treatments make the feed unnecessarily tall.

## Five design hypotheses

1. **One lead, then compact rows.** The API sorts by publication time descending, so the first dated article can lead without inventing an editorial score. Remaining items retain the same data but use less visual weight.
2. **Source is metadata, not a second CTA.** The original publication link sits in the source line, and the article headline remains the internal detail action.
3. **The right rail is a provenance utility.** Keep crawl status and last success/attempt as a narrow list, not a chart or KPI cluster.
4. **Facts and interpretation remain distinct.** Feed articles do not show AI confidence or conclusions that their list API does not provide; detail pages keep the existing analysis contract.
5. **Risk alerts get their own semantic treatment.** Verification status must be written in text; an unverified alert needs a restrained warning rule, never a green treatment borrowed from a trusted source.

These are implementation hypotheses, not claims about user testing. The reference screenshot and resulting screen still require team review.
