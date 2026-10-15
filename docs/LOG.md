# NexusForge — Engineering Log

Newest entries at the bottom of each day. Facts only: what was done, what
actually happened, what it implies. Failures are recorded, not hidden.

---

## 2026-10-15 — Stage 1: feasibility audit and walking skeleton

### Environment audit

- **OS** Windows 11 Pro 10.0.22000. **Node** v22.21.1. **npm** 10.9.4. **Git**
  2.52.0.windows.1. **Docker NOT installed** — not needed, we use FalkorDB
  Cloud, so no action taken.
- Repository contained only `.gitignore` and `.gitattributes` across 2 commits
  (`ac2f650`, `0c7b690`). **No existing Next.js app, no dependencies, no
  tests.** Nothing to preserve, so scaffolding was safe.
- `origin` verified as `https://github.com/gideonadesina/nexusforge.git`;
  branch `main`. Not LessonForge. No LessonForge asset was touched.

### SECURITY FIX — `.gitignore` was not working

- **Discovery:** `git status` listed `.env.local` as *untracked* rather than
  ignored. `git check-ignore -v .env.local` returned no match.
- **Cause:** every line of `.gitignore` carried three leading spaces
  (`"   .env*"`). Git treats leading whitespace as part of the pattern, so none
  of the four rules matched anything. Confirmed with `od -c .gitignore`.
- **Impact:** credentials were one `git add .` away from being committed.
- **Fix:** rewrote `.gitignore` with correct patterns. Re-verified:
  `git check-ignore -v .env.local` → `.gitignore:6:.env.*`, and
  `git ls-files -- .env.local` → empty (untracked).
- **Implication:** this is exactly why "audit before scaffolding" exists. A
  clean-looking repo was actively unsafe.

### Environment variables

- Names present (values never read or printed): `FALKORDB_HOST`,
  `FALKORDB_PORT`, `FALKORDB_USERNAME`, `FALKORDB_PASSWORD`, `FALKORDB_TLS`.
- `FALKORDB_GRAPH` was **absent**; added as `nf_demo_education` by a script
  that appends without reading contents to stdout.

### Hackathon requirements

- Fetched both official pages. Deadline **Oct 18, 11:59 PM IST = 19:29 WAT**,
  confirming the previously recorded figure. Tracks 01 and 03 exist under the
  names we assumed. Recorded in `docs/REQUIREMENTS.md`.
- Mandatory: public repo, README **with graph data model**, the Cypher queries
  used, demo video, live deployment *or* local setup instructions, named
  tracks. **AI assistance must be disclosed.**
- Repo is currently private and must be made public before submission —
  **requires founder authorization, not done.**

### Dependency versions

- My assumed versions were stale. Actual latest installed: `falkordb@6.8.0`,
  `next@16.4.1`, `vitest@5.0.4`, `zod@4.6.7`, `react@19.2.0`.
- `npm install` took **21 minutes** on this machine. Budget for that.

### FalkorDB client API — verified against installed typings, not assumed

Read `node_modules/falkordb/dist/**/*.d.ts` directly. Confirmed:

- `FalkorDB.connect(options)`, `db.selectGraph(name)`, `db.list()`,
  `db.close()`, `graph.query<T>()`, `graph.roQuery<T>()`, `graph.delete()`.
- `QueryOptions = { params?, TIMEOUT? }` — parameterized queries and a
  server-side timeout are both supported. We set `TIMEOUT` on every query.
- **Correction made:** the reply's statistics field is `metadata` (a
  `string[]`), not `statistics`. My first draft read the wrong field; fixed.
- **Correction made:** the driver's `QueryParams` type is declared but **not
  exported**, and its index signature rejects ordinary interfaces. Narrowed
  once at the driver boundary in `client.ts` with a documented cast rather than
  weakening types everywhere.

### Mistake — hostname leaked to terminal

- My first redaction masked password and username but **not the host**. The
  first failed connection printed the full instance hostname to the terminal.
- **Fix:** added `maskHost()` in `env.ts`; `describeTarget()` and the error
  redactor now mask the host too. Verified by test: the connection summary
  contains neither `FALKORDB_PASSWORD` nor `FALKORDB_HOST`.

### Intermittent DNS — real, and it will affect the demo

- Two separate runs failed with `getaddrinfo ENOTFOUND` for the instance host,
  while `example.com` resolved fine and the host resolved correctly moments
  later. Not an instance outage — transient resolver failure.
- `scripts/diagnose-connection.ts` distinguishes "machine offline" from "this
  host is gone" and prints masked hostnames only.
- **Fix:** bounded retry (4 attempts, 0.5s/1s/2s backoff) on transient network
  errors in `getDb()`. A genuinely dead instance still fails and reports.
- **Risk:** if this recurs during judging, a live demo could fail on first
  load. Retry mitigates but does not eliminate it.

### Cloud free-tier claims — partially verified

Checked against <https://docs.falkordb.com/cloud/>:

| Claim | Status |
|---|---|
| 100 MB RAM | **VERIFIED** — docs state 100 MB on AWS or GCP |
| No TLS | **VERIFIED** — docs: "TLS and automated backups start at Startup" |
| No backups | **VERIFIED** — same statement |
| No persistence | **UNKNOWN** — not stated on the page fetched |
| Stops after ~1 idle day | **UNKNOWN / NOT TESTED** — no official statement found |
| Deleted after ~7 idle days | **UNKNOWN / NOT TESTED** — no official statement found |

**Do not treat the idle-stop and idle-delete figures as verified.** They remain
planning assumptions. The re-seed pathway exists precisely because we cannot
rely on the instance surviving.

### Pre-existing graphs — recorded assumption was WRONG

- Planning said the cloud instance held **two** pre-existing graphs.
- `GRAPH.LIST` returned **zero** graphs. The instance was empty.
- **Implication:** either the graphs were never created, or the instance was
  reset/reclaimed. The second possibility supports the idle-reclamation theory
  and raises the importance of the re-seed path. Nothing was deleted by us.

### Database probe — PASSED

`npx tsx scripts/probe.ts` against the real instance. All checks passed:
connect; read-only list; create isolated `nf_probe_*` graph; 2-hop traversal
returning the exact expected path; `RO_QUERY` rejecting a write with node count
unchanged; ownership guard refusing a non-`nf_` graph; probe graph deleted and
all pre-existing graphs still present.

### Walking skeleton built

- Seed: 17 entities, 7 sources, 17 `DEPENDS_ON`, 18 `EVIDENCED_BY`. Read-back
  census matched the domain pack exactly on the first run.
- Impact analysis found **10 distinct exposed entities via 13 paths**, and an
  independently formulated re-check query agreed on 10.
- Decoys (`SS1 Physics`, Bello, Danjuma, PE assignment, athletics club) were
  excluded, while SS2/SS3 Physics were included — proving structural rather
  than keyword matching.

### Tests — 41 passed, 0 skipped, real database

`npx vitest run` → **3 files, 41 tests, all passing.** No mocked FalkorDB
exists anywhere in the project.

One earlier run failed (`seed-idempotency.test.ts`) on the transient DNS fault
described above; it passed after the retry fix. Recorded rather than quietly
re-run.

### Build

`npx tsc --noEmit` clean under strict mode (plus `noUncheckedIndexedAccess`).
`npx next build` succeeded — 2 static routes. Next 16 rewrote `tsconfig.json`
`jsx` to `react-jsx` and added `.next/dev/types`; change accepted.

---

## FalkorDB experiment status

| ID | Topic | Status |
|---|---|---|
| E1 | Multi-hop traversal | **TESTED — passed** |
| E2 | Cycle handling | **TESTED — passed** |
| E4 | Relationship uniqueness / multiple paths | **TESTED — passed** (folded into golden tests, as directed) |
| E7 | Read-only enforcement | **TESTED — passed** |
| E3 | Shortest-path behaviour, `min(length(p))`, built-in algorithms | **NOT TESTED** — deferred, no Stage 1 decision depends on it |
| E5 | Algorithm procedure signatures and `YIELD` fields | **NOT TESTED** — deferred, no procedures used |
| E6 | Full-text indexing for entity resolution | **NOT TESTED** — deferred, entity resolution is Stage 2+ |
| E8 | Multi-statement write atomicity | **NOT TESTED** — deferred. We do **not** claim atomicity; see below |
| E9 | Memory overhead, sandbox capacity, copy/re-seed timing | **NOT TESTED** — deliberately skipped; destructive load testing on a shared free-tier instance was out of bounds |

### E1 — multi-hop traversal (TESTED)

Bounded variable-length pattern walking dependency edges in reverse:
`MATCH p = (affected:Entity)-[:DEPENDS_ON*1..N]->(root:Entity {id: $rootId})`.

Works with a parameterized root. **The depth bound cannot be parameterized** —
openCypher rejects a parameter inside `*1..n`. It is therefore validated as an
integer in `1..8` by `assertDepth()` and interpolated; nothing else is ever
interpolated into a query.

Evidence: `tests/impact.test.ts` "Test 1 — multi-hop discovery".

### E2 — cycles (TESTED)

A deliberate cycle exists in the seed: examinations committee ↔ science
examinations coordination. Bounded queries terminate, distinct counts are not
inflated, and the result is identical at depth 6 and depth 8 — an unbounded
traversal would keep growing.

**Deduplication happens in BOTH places, deliberately:**

1. *In Cypher* — a node-distinctness predicate rejects trails that revisit a
   node: `ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)`.
   This matters because openCypher's relationship-uniqueness alone still admits
   node-revisiting trails, which a cycle produces.
2. *In application code* — routes are collapsed per entity, keyed by path
   signature, so one entity reached by three routes is one impacted entity.

Evidence: `tests/impact.test.ts` "Test 6 — cycle safety".

### E4 — relationship uniqueness (TESTED, folded into golden tests)

The seed deliberately gives the WAEC mock exam **three** valid routes to the
resigning teacher and the lab-practical responsibility **two** (of differing
length: 1 and 2 edge hops). Verified that the entity is counted **once** while
all alternative routes remain inspectable under `allPaths`.

`totalPathCount` (13) is reported separately from `distinctImpactedCount` (10)
and the two are never conflated.

Evidence: `tests/impact.test.ts` "Test 4 — relationship uniqueness".

### E7 — read-only enforcement (TESTED)

`graph.roQuery()` issues `GRAPH.RO_QUERY`. The **server** rejects writes:

> `graph.RO_QUERY is to be executed only on read-only queries`

Verified for `CREATE`, `SET`, `DELETE`, and `MERGE`, each followed by a
post-check confirming node count, property values, and absence of the illegal
node — i.e. rejection *and* non-mutation were both proven.

Evidence: `tests/connection-and-readonly.test.ts`.

### E8 — atomicity (NOT TESTED) — and what we claim instead

FalkorDB executes each `GRAPH.QUERY` atomically, but the seed spans five
statements and there is **no cross-statement transaction**. We therefore **do
not claim atomicity**.

Instead the seed is *recoverable*: every statement is `MERGE`-keyed on a stable
id, so a run that dies partway is repaired by re-running. A `SeedMarker` node
is written **last**, so `complete: true` only ever appears when every preceding
step succeeded. `isSeeded()` checks that marker.

Limitation, stated plainly: a seed interrupted mid-run leaves a partial graph
that is detectable (no marker) but not automatically rolled back.

---

## Day 2 requirement — analysis-run isolation and safe reset

Recorded now, **deliberately not implemented in Stage 1** (Guardrail 9).

A shared synthetic graph is acceptable today, but multiple judges interacting
with mutable state is a real risk. Day 2 must:

- Give every analysis a unique `analysisRunId`.
- Scope findings, proposed actions, approval states, and audit events to that
  run — **not** to the graph globally.
- Make "reset" start a **fresh analysis run**, never mutate or delete the
  underlying synthetic organizational seed, and never destroy another user's
  active analysis history.
- Define a cleanup policy for old demo runs that respects the 100 MB free-tier
  limit.
- **Never silently delete audit records while claiming they are preserved.** If
  cleanup removes runs, say so explicitly in the UI and docs.

---

## Open risks carried into Stage 2

1. **Intermittent DNS** to the cloud instance. Mitigated by retry; not solved.
2. **Free-tier idle behaviour UNVERIFIED.** The instance may vanish. The
   re-seed path (`ensureSeeded`) is tested and exists for this reason.
3. **100 MB RAM** is verified and small. Per-visitor graph copies are likely
   unaffordable; analysis-run scoping inside one graph is the right design.
4. **Repo is private.** Must be made public before submission — founder's call.
5. **No TLS on the free tier** (verified). Credentials cross the network
   without transport encryption. Acceptable for synthetic demo data only; must
   not be used for anything real.
6. **Blog-post prize rules UNKNOWN.**
