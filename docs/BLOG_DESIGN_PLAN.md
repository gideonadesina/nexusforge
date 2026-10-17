# Blog page: design and publishing plan

Companion to `docs/BLOG_POST.md`. Nothing here is built yet. This is for
review before any implementation.

## Constraint first

The main submission and demo video take priority. This plan is deliberately
small enough to abandon. Nothing in it touches the investigation UI, adds a
dependency, or introduces new infrastructure.

## Publishing approach

Three options, in the order I would pick them.

**1. Publish on an external platform (recommended).** Hashnode or dev.to.
Markdown paste, fast, and the prize almost certainly expects a public article
URL rather than a file in a repository.

- Cost: no animated diagram. Static images only.
- Risk: near zero.

**2. A static route in this app at `/story`.** A separate page that imports
nothing from the investigation UI and reuses only the design tokens. Allows
the animated diagram.

- Cost: roughly half a day, plus review.
- Risk: it is a new route on the production deployment days before judging.

**3. Both.** Publish externally, then add the route if time genuinely allows,
with the external URL as the canonical submission link.

I recommend **1 now, 3 if the schedule holds**. A great article on a boring
page beats a beautiful page nobody finished.

### What I could not verify

**I have not confirmed how the Best Blog Post prize is submitted.** The
hackathon pages we fetched confirm the prize exists (AirPods 5, one winner)
but state no submission mechanism, no eligibility rules, and no deadline.
`docs/REQUIREMENTS.md` records this as UNKNOWN.

Before publishing anywhere, someone needs to check:

- Is an external URL required, or is a repository file acceptable?
- Is a specific platform, tag or hashtag required?
- Does it need to be submitted alongside the main track entry or separately?
- Is the deadline the same as the main one (18:29 WAT, 18 October)?

Do not assume a Markdown file in the repo is eligible. That is the single
most likely way to lose the prize on a technicality.

## Visual direction

Reuse the existing NexusForge tokens exactly. No new palette.

- Warm graphite surfaces, four elevation steps separated by luminance
- One accent, the existing teal, for the traced path and links only
- Monospace for anything that came out of the graph; proportional for prose.
  This is the product's typographic rule and the article should obey it, so
  entity ids, relationship types and Cypher are monospace throughout
- Measure capped around 68 characters. Code blocks may break out wider

## Page structure

1. **Opening.** The incident, in prose, on a plain dark surface. No hero
   graphic competing with the first sentence. The headline and the first
   paragraph are the hook.
2. **The chain, as a static diagram.** Five nodes, four arrows, left to right.
   Appears immediately after the opening so the reader sees the shape before
   the explanation.
3. **Direct lookup versus traversal.** Side-by-side comparison.
4. **Narrative sections**, following the article, with code and Cypher inline.
5. **Evidence screenshot** at the point the article discusses provenance.
6. **The getting-it-wrong section**, with the claim classification table.
7. **Close**, with demo and source links.

## Asset list

Screenshots to capture from the live site, Northstar loaded:

| # | Shot | Notes |
|---|---|---|
| 1 | Full investigation view after Run analysis | Shows headline, canvas, findings |
| 2 | Trace active on the Meridian finding | The dimming is the point. Crop to the canvas |
| 3 | Inspector open, scrolled to evidence | Must show a verbatim excerpt |
| 4 | Inspector query receipt | Cypher template plus bound parameters |
| 5 | The failover plan node | Dashed border, hollow fill, "partial evidence" label |
| 6 | Proposals with the approval bar | Must show "not executed" wording |
| 7 | Organization switcher | Evidence of the cross-sector claim |

Capture at 2x on a dark background, viewport around 1440px. Crop tightly;
full-window screenshots read as clutter at article width.

**Do not capture:** the terminal, `.env.local`, the Vercel dashboard, or any
view containing a real hostname.

## The one animation worth building

A four-hop reveal of the Meridian chain, and nothing else.

- Five nodes in a row, drawn from real ids:
  `ns_commitment_meridian`, `ns_obligation_soc2_evidence`,
  `ns_svc_audit_processor`, `ns_topic_inference_events`,
  `ns_svc_inference_gateway`
- On scroll into view, reveal one hop at a time, roughly 240ms apart,
  opacity and transform only
- Each arrow labelled with its real relationship id, in monospace
- A caption stating the elapsed analysis time as measured, around 40ms, and
  making clear the animation is exploration of a completed result rather than
  live computation

Implementation: inline SVG plus CSS transitions and one
`IntersectionObserver`. No animation library. Perhaps 80 lines.

It must honour `prefers-reduced-motion` by rendering the final state
immediately, and it must be a static diagram on narrow screens.

**Everything else stays still.** No parallax, no scroll-jacking, no counters
ticking up, no particles. The animation earns its place only because the
article's central claim is about distance, and distance is the one thing
prose conveys poorly.

## Direct lookup versus traversal

A two-column comparison, static:

| Direct lookup | Graph traversal |
|---|---|
| `SELECT * FROM deps WHERE target = 'gateway'` | `MATCH p = (a)-[:DEPENDS_ON*1..6]->(root)` |
| Returns 2 services | Returns 10 entities across 12 paths |
| You must know which joins to write | The bound replaces the guess |
| Misses the contract entirely | Finds it at hop 4 |

The numbers are real. Re-verify before publishing.

## Responsiveness and accessibility

- Single column throughout. No multi-column layout to collapse
- Code blocks scroll horizontally inside their own container; the page body
  never scrolls sideways
- The chain diagram becomes a vertical list of labelled steps below 640px,
  which is also the screen-reader presentation
- Honour `prefers-reduced-motion` and `prefers-contrast`
- Every image needs real alt text describing what the screenshot shows, not
  "screenshot of NexusForge"
- Target around 4.5:1 contrast for body text on the graphite background

## Effort

| Task | Estimate |
|---|---|
| Capture and crop 7 screenshots | 45 min |
| Static chain diagram (SVG) | 30 min |
| Animated version (if route is built) | 60 min |
| External publication and formatting | 30 min |
| Optional `/story` route | 3 to 4 hours |

## Before publishing

- [ ] Confirm the actual blog prize submission mechanism and deadline
- [ ] Re-run the Northstar analysis and re-verify every figure in the article
- [ ] Confirm the proposal counts on screen, since the suppression rule
      changed them
- [ ] Owner reviews the article for accuracy and voice
- [ ] Confirm no screenshot contains a hostname, token or credential
- [ ] Decide whether the repository is public first, since the article links
      to it
