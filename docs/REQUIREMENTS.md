# Graph Hacks 2026 — Verified Competition Requirements

**Verification date:** 2026-10-15 (WAT)
**Verified by:** fetched the official pages listed below. Nothing in this file
comes from prior conversation or assumption.

## Official sources

- Event page — <https://www.wemakedevs.org/hackathons/falkordb>
- Rules page — <https://www.wemakedevs.org/hackathons/falkordb/rules>

Status legend: **VERIFIED** (stated on an official page), **UNKNOWN** (not
found on the pages fetched), **NOT APPLICABLE**.

---

## Event identity and dates

| Item | Status | Detail |
|---|---|---|
| Event name | VERIFIED | "Graph Hacks: Context for AI Agents" |
| Organizer | VERIFIED | WeMakeDevs, powered by FalkorDB |
| Event window | VERIFIED | October 15–18, 2026 |
| Format | VERIFIED | Online, worldwide |
| Submission deadline | VERIFIED | **October 18, 11:59 PM IST** |
| Deadline in WAT | VERIFIED (computed) | IST is UTC+05:30, WAT is UTC+01:00 → 23:59 IST = 18:29 UTC = **19:29 WAT on October 18, 2026** |

The previously recorded internal figure of **19:29 WAT** is therefore
**correct**. The conversion was re-derived here rather than carried over.

### Internal milestones (ours, not official)

- Feature freeze — October 16, 2026, 22:00 WAT
- Internal submission target — October 17, 2026, 17:00 WAT

---

## Tracks

| # | Exact name | Focus (as published) |
|---|---|---|
| Track 01 | **Agents That Act on Connected Data** | Multi-hop reasoning, graph queries as agent tools, tool selection via MCP, explainable results |
| Track 02 | **Agent Memory and Coordination** | Episodic/semantic/procedural memory, persistent history, shared state, concurrent reads/writes |
| Track 03 | **Company Brain** | "Build an agent that understands how a company works" — people, teams, projects, documents, decisions |

- **Multiple tracks allowed:** VERIFIED. Participants "may enter any or all of
  them, and you must name every track you are entering when you submit."
- **Separate prize per track:** VERIFIED.

**Our intended targets — Track 01 and Track 03 — both exist under those exact
names.** Note Track 02 is *Agent Memory and Coordination*; do not mis-cite it.

---

## Mandatory submission artifacts (Rule 10)

All VERIFIED as required:

1. Public source-code repository
2. README with setup instructions **and the graph data model**
3. The Cypher queries or graph algorithms the product depends on
4. Demo video showing the working project
5. Live deployment **or** complete local setup instructions
6. Identified track(s)

| Item | Status | Note |
|---|---|---|
| Public repo required | VERIFIED | Repo is currently **private**; must be made public before submission. Visibility change requires founder authorization. |
| Live deployment strictly required | VERIFIED — NO | Deployment is *preferred*; projects without it need complete local setup instructions **and** a working demo video. |
| Demo video length / format | UNKNOWN | No duration, hosting, or format requirement found on the pages fetched. |

---

## Technology requirements

| Item | Status | Detail |
|---|---|---|
| FalkorDB mandatory | VERIFIED | Must be "the primary graph database" and "support a central part of the product" |
| Graph must do real work | VERIFIED | "The graph must do functional work; visualization alone doesn't qualify" |
| Hosting of FalkorDB | VERIFIED | Docker, self-hosted, or FalkorDB Cloud all accepted |
| Language/framework | VERIFIED | Any language, framework, frontend, or deployment platform |

---

## Work-start and pre-existing code

| Item | Status | Detail |
|---|---|---|
| Start restriction | VERIFIED | "The main coding and design work must begin after the hackathon starts" |
| Preparation allowed | VERIFIED | Ideas, notes, graph model sketches, and diagrams may be prepared beforehand |
| Original work | VERIFIED | Submissions and the main FalkorDB implementation must be "new work completed during the event" |
| Reuse permitted | VERIFIED | General libraries, frameworks, templates, public APIs, third-party tools, public datasets |

**Compliance note:** all NexusForge implementation code was written on
2026-10-15, inside the event window. The repository's two pre-event commits
contain only `.gitignore` and `.gitattributes` — no implementation.

---

## AI assistance

| Item | Status | Detail |
|---|---|---|
| AI assistants allowed | VERIFIED | "AI coding assistants are allowed, but their use must be disclosed" |
| Disclosure mandatory | VERIFIED | Must be disclosed at submission |
| Responsibility | VERIFIED | "You remain responsible for the code, architecture, security, and correctness" |
| Must understand own code | VERIFIED | Participants must "understand the submitted code and be able to explain" architecture and decisions |
| Fully AI-generated projects | VERIFIED | "Projects entirely generated using AI without meaningful participant contribution" may be rejected |

**Action required:** an AI-assistance disclosure must appear in the submission
and the README.

---

## Data rules

| Item | Status | Detail |
|---|---|---|
| Permitted data | VERIFIED | "Public, synthetic, or your own" |
| Prohibited data | VERIFIED | Private, login-protected, paywalled, or personal information |

**Compliance note:** NexusForge uses 100% synthetic data, labelled
`synthetic: true` on every seeded node.

---

## Team and eligibility

| Item | Status | Detail |
|---|---|---|
| Team size | VERIFIED | Solo or up to 4; each person limited to one team |
| Eligibility | VERIFIED | Developers worldwide; no prior graph experience required |
| Intellectual property | VERIFIED | "Any intellectual property developed during the hackathon belongs to the participant or team that created it" |

---

## Prizes

| Award | Prize | Status |
|---|---|---|
| Total pool | $20,000 | VERIFIED |
| Track 01 | iPhone 18 Pro | VERIFIED |
| Track 02 | PS5 with GTA VI | VERIFIED |
| Track 03 | M6 Mac Mini | VERIFIED |
| Best Blog Post | AirPods 5 (1 winner) | VERIFIED |
| Top 50 teams | T-shirt | VERIFIED |

### Best Blog Post prize

| Item | Status |
|---|---|
| Prize exists | VERIFIED |
| Submission mechanism | **UNKNOWN** |
| Whether it requires a track submission | **UNKNOWN** |
| Word count / platform / tagging rules | **UNKNOWN** |
| Deadline (same as main deadline?) | **UNKNOWN** |

**Do not assume the blog prize shares the technical-track submission process.**
This must be clarified before relying on it.

---

## Judging

The event page lists judging *indicators*:

- Graph integration quality and necessity
- Agent reasoning and decision-making capability
- Implementation completeness and functionality
- Documentation and explainability

| Item | Status |
|---|---|
| Published numeric weights | **UNKNOWN** — none found |
| Formal scoring rubric | **UNKNOWN** |
| Judge identities / process | **UNKNOWN** |

**No scoring weights have been invented.** Treat the four indicators above as
directional only.

---

## Outstanding UNKNOWNs to resolve

1. Best Blog Post submission mechanism, rules, and deadline.
2. Demo video duration/hosting requirements.
3. Formal judging rubric and any weights.
4. Whether the submission portal requires anything beyond the Rule 10 list.
5. Exact submission portal URL and whether registration is a prerequisite.

---

## Hosting constraints (Vercel) — researched, nothing deployed

Fetched 2026-10-15 from official Vercel docs. **No Vercel project was created,
connected, deployed, or modified.**

Sources: <https://vercel.com/docs/functions/limitations>,
<https://vercel.com/docs/cron-jobs/usage-and-pricing>

| Item | Hobby | Pro |
|---|---|---|
| Function max duration | 300s default **and** maximum | 300s default, 800s max, 1800s extended (beta) |
| Function memory | 2 GB / 1 vCPU | up to 4 GB / 2 vCPU |
| Request/response body | 4.5 MB | 4.5 MB |
| Cron minimum interval | **once per day**, ±59 min precision | once per minute |
| Cron jobs per project | 100 | 100 |
| Default region | `iad1` (single region) | multi-region available |

Implications for NexusForge:

- 300s on Hobby is far more than our traversals need (observed query times are
  sub-millisecond server-side). **Not a blocker.**
- Hobby cron is once-per-day only. Any "clean up old analysis runs" job must
  either accept daily granularity or run on demand. **Not a Stage 1 concern.**
- FalkorDB Cloud free tier is non-TLS; outbound TCP from Vercel functions is
  supported, but **this has not been tested from Vercel** — only from local
  Windows. Marked UNVERIFIED.
- File descriptor limit (1,024 shared) means the FalkorDB connection must be
  reused, not opened per request. Our client already caches one connection.

**Requires founder's manual inspection (account-specific, not documented):**

1. Which plan the NexusForge Vercel account is on (Hobby vs Pro).
2. Whether a `nexusforge` project already exists.
3. Environment variable configuration in project settings.
4. Confirmation that the LessonForge project is untouched.
