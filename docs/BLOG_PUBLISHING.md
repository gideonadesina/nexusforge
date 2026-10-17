# Blog submission package

Everything needed to publish the NexusForge article and submit the link.
Article draft: [`docs/BLOG_POST.md`](./BLOG_POST.md).

## Title

**Recommended:**

> **The contract nobody knew was at risk**
> *An AI gateway fails. Four relationships away, a customer obligation is
> exposed. Here is how we found it.*

It leads with the consequence rather than the technology, which is what makes
someone open the tab. "Nobody knew" is the tension, and the subtitle resolves
what the article is actually about.

**Alternatives:**

2. *Four hops from an outage to a breached contract*. More concrete and
   slightly drier, probably better for a graph-database audience specifically.
3. *The dependency your service catalogue cannot see*. Strongest for an SRE
   or platform-engineering readership, weakest at conveying what was built.

## Excerpt

For the preview card, under 200 characters:

> An AI inference gateway went down for thirty minutes. Three weeks later a
> customer compliance obligation failed, four relationships away. Building a
> graph engine that finds that chain.

## Cover image

**File:** `docs/assets/cover.svg` (1600 x 840, exported from the project's own
design tokens).

Concept: warm graphite background, the title set large on the left with "at
risk" in the product's teal accent, and the five node chain rendered small on
the right so the shape of the finding is visible before you read a word. The
footer carries the three real figures: 10 entities, 12 dependency paths, 40 ms.

Both Hashnode and DEV expect a raster cover. **Export to PNG at 1600 x 840
before uploading** (open the SVG in a browser and screenshot, or use any SVG to
PNG converter). SVG covers are unreliable on both platforms.

## Screenshot shot list

I could not capture these: the browser automation tooling is not connected in
this environment. Every shot below needs to be taken manually from
<https://nexusforge-ten.vercel.app> with **Northstar Labs** loaded.

Capture at 2x device pixel ratio, viewport around 1440 px wide, dark theme
(the app has no light mode). Crop tightly. Full window screenshots read as
clutter at article width.

| # | Capture | Why it matters | Caption | Placement |
| --- | --- | --- | --- | --- |
| 1 | Full investigation view just after **Run analysis**, nothing selected | The hero. Shows headline counts, hop columns, directed edges and the findings list in one frame | "One query, 10 exposed entities across 12 dependency paths, about 40 ms. The columns are hop distance from the change." | Full width, directly under the subtitle |
| 2 | **Trace active** on the Meridian commitment, Inspector closed | The signature interaction. The dimming is the entire point, so crop to the canvas only | "Selecting a finding highlights the exact relationships the engine walked and dims everything else. The arrowheads show the stored dependency direction; impact runs the other way." | Full width, after "The Meridian chain" |
| 3 | **Inspector open**, scrolled to evidence, on the failover plan | Proves the honesty claim: a verbatim excerpt beside an unresolved reference | "Evidence is a verbatim excerpt from a source record. When a reference does not resolve, the gap is named rather than hidden." | Full width, after the "Saying I do not know" section |
| 4 | **Proposals** with the approval bar visible | Must show the "not executed" wording in frame | "Approval records a decision. It is not an execution, and the interface says so next to the button rather than in a footnote." | Inline, after the proposals section |
| 5 | **Inspector query receipt** (Cypher template plus bound parameters) | Strongest single proof that findings are checkable | "Every finding exposes the query that produced it, including the bound parameters and the relationship ids walked." | Inline, optional, near the FalkorDB section |
| 6 | **Organization switcher** open, both organizations visible | Evidence for the cross-sector claim in one frame | "The same engine, a different graph. Organizations are isolated at the database boundary, not by a WHERE clause." | Inline, optional, near "Modelling Northstar Labs" |

**Do not capture:** the terminal, `.env.local`, the Vercel dashboard, or any
view showing a real hostname.

Shots 1 to 4 are the ones worth insisting on. If time is short, publish with
those four.

### One thing to fix before shot 2 or 3

The deployed graph still stores the Meridian entity name with an em dash
(`Meridian Health MSA — compliance evidence clause 8.2`). The committed seed
now uses a comma, but production has not been re-seeded, so a screenshot taken
today will contradict the punctuation cleanup.

I did not run this, because it writes to production data:

```bash
npx tsx scripts/seed-org.ts northstar
```

It is idempotent and MERGE-based: it updates names in place, creates nothing
new, and leaves the analysis runs, findings and proposals untouched. Run it,
confirm the census still reports 18 entities and 8 sources, then take the
screenshots.

## Motion plan

Two assets, both already built, both lightweight.

### 1. Four hop reveal (primary)

**File:** `docs/assets/meridian-chain.svg`
**Fallback:** `docs/assets/meridian-chain-static.svg`

A vertical five node chain revealing one hop at a time, 340 ms per step,
opacity and transform only. Every node id and every relationship id is real,
taken from the live API response, not illustrative. It honours
`prefers-reduced-motion` by rendering the finished state immediately.

It earns its place because the article's central claim is about *distance*,
and distance is the one thing prose conveys badly. Nothing else on the page
moves.

**Platform caveat:** neither Hashnode nor DEV reliably animates an uploaded
SVG, since both usually serve it inside an `<img>` where CSS animation support
varies, and DEV sometimes rejects SVG uploads entirely.

Recommended approach, in order:

1. Open `meridian-chain.svg` in a browser, screen-record the eight second
   reveal, export a GIF or MP4, and upload that. This is the most reliable
   path and takes about five minutes.
2. If you want zero extra work, upload `meridian-chain-static.svg` exported to
   PNG. The diagram is designed to read correctly without motion.

### 2. Trace interaction (optional, only if cheap)

A six to eight second screen recording of the real interface: click the
Meridian finding, watch the path highlight and everything else dim, open the
Inspector, close it, and show the trace survives.

This is more convincing than any diagram, because it is the product rather
than a drawing of it. Record it only if the main submission video is already
done; it is the first thing to cut.

**Do not build:** a custom `/story` route, a scroll-driven microsite, or any
animation library. I considered a dedicated route and concluded it is not
worth the time this close to the deadline: it would put new code on the
production deployment days before judging, for a presentation gain an external
platform already provides.

## Platform recommendation

**Hashnode**, for three reasons: it renders Markdown with fenced code blocks
and syntax highlighting faithfully, it allows a canonical URL if you later
cross-post, and its table rendering is more reliable than DEV's for the two
comparison tables in the article.

DEV is a reasonable second choice. If you use it, note that its Markdown
flavour prefers `{% embed %}` liquid tags for rich media, and its SVG handling
is the weakest of the two.

### Formatting notes for either platform

The article is written in portable Markdown and needs no restructuring. Two
mechanical steps:

1. **Replace the HTML comment markers** with real uploads. Each
   `<!-- SCREENSHOT n -->` and `<!-- IMAGE: path -->` marks an insertion point.
2. **Upload images through the platform's uploader** and paste the returned
   URL. Do not hotlink from GitHub raw; both platforms rewrite and cache their
   own uploads, and raw links break when the repository moves.

Heading structure is already two levels deep (`##` for sections, `###` for the
three bug subsections), which is what both platforms' table of contents
generators expect. Do not add `#` headings inside the body: the title field
supplies the `h1`.

Suggested tags: `graphdatabase`, `falkordb`, `typescript`, `hackathon`.

## Before you publish

- [ ] Re-seed Northstar so the entity name matches the committed seed
- [ ] Re-run the analysis and confirm every figure in the article: 10 entities,
      12 paths, 4 hops, 3 OBSERVED and 7 DERIVED, 3 reassignment and 3 evidence
      gap proposals
- [ ] Capture shots 1 to 4 at minimum
- [ ] Export the cover to PNG at 1600 x 840
- [ ] Decide on the animation: screen recording, or static PNG
- [ ] **Make the repository public.** The article links to it, and a 404 on the
      source link is worse than no link
- [ ] Read the article once yourself for voice. It is written in first person
      as you, and you should be comfortable standing behind every sentence
- [ ] Confirm no screenshot shows a hostname, token or credential

## Still unknown, and worth checking first

The official hackathon pages confirm the Best Blog Post prize exists (AirPods
5, one winner) but state **no submission mechanism, no platform requirement,
no tagging rule and no separate deadline**. This is recorded as UNKNOWN in
[`docs/REQUIREMENTS.md`](./REQUIREMENTS.md).

Before publishing, confirm:

- Is an external URL required, or is a repository file acceptable?
- Is a specific platform, tag or hashtag required?
- Is it submitted on the main form, or separately?
- Is the deadline the same as the main one, 18:29 WAT on 18 October?

Getting this wrong is the most likely way to lose the prize on a technicality,
and it costs five minutes to check.
