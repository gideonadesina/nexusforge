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

## 2026-10-15 — Stage 2A: persisted analysis runs, findings, and authorization

### What was added

- `:AnalysisRun` and `:Finding` nodes, with `PART_OF_RUN`, `ABOUT`, and
  `CITES` edges. FalkorDB remains the only datastore.
- Run-scoped authorization via an opaque owner token (SHA-256 hashed at rest).
- Zod-based traversal-depth validation at the one Cypher interpolation point.
- Relationship ids are now returned by the traversal and stored on findings, so
  a persisted finding can be re-checked against the exact edges it came from.

### Authorization design

An `analysisRunId` is an identifier, not a credential. Mutations additionally
require an `ownerToken` (32 random bytes, base64url).

**The ownership check lives inside the mutating statement:**

```cypher
MATCH (run:AnalysisRun {analysisRunId: $runId, ownerTokenHash: $ownerTokenHash})
<mutation body>
```

If the MATCH binds nothing, every downstream clause is skipped and no write
occurs. There is no separate check-then-write step, so **no TOCTOU window
exists**. A rejected attempt returns zero rows, which `withRunAuthorization`
converts into a `RunAuthorizationError`.

All run mutations funnel through `withRunAuthorization`. Forgetting to
authorize would mean not calling it at all — visible in review, not a silent
bypass. `runId` and `ownerTokenHash` are reserved parameter names and a caller
supplying either is rejected.

Only the hash is persisted; the plaintext token is returned exactly once, in
memory, and never logged. `RUN_COLUMNS` deliberately omits `ownerTokenHash`,
and a test asserts it never appears in any read result.

**Three explicitly separate pathways:**

1. `createAnalysisRun` — mints a credential, so necessarily requires none.
2. `withRunAuthorization` — every subsequent mutation.
3. `adminDeleteRun` — operator cleanup that bypasses ownership by design.
   Requires an explicit `iUnderstandThisBypassesOwnership: true` plus a reason,
   and is not reachable from any request path (there is no HTTP surface yet).

**Limitation, stated plainly:** a run owner token proves only "this caller
created this run". It is **not** proof of human identity and **not**
authority to perform a business action. Stage 2B must add action-specific
approval authority on top.

### Token transport — designed, NOT wired

`src/lib/runs/token-transport.ts` defines an HttpOnly + Secure + SameSite=Lax
cookie carrying a `runId -> token` map, so one visitor can hold several
concurrent runs without collision, capped at 10 entries. Pure functions, unit
tested, **not connected to any route** — there is no HTTP surface in Stage 2A.

### Idempotency and retry-vs-new

`findingId` is deterministic: `${analysisRunId}::${entityId}`. Re-persisting
MERGEs onto the same ids, so a retry cannot duplicate findings, `CITES`, or
`ABOUT` edges — all three are asserted.

A **new** analysis (`runAndPersistAnalysis`) always mints a new run id and
token. A **retry** (`retryPersistAnalysis`) reuses existing credentials and
increments `persistAttempts`, which is how the two are distinguished.
`createdAt` is preserved via `coalesce` while `updatedAt` advances.

### Findings are computed, never fabricated

`runAndPersistAnalysis` calls `analyseImpact` against the real graph and writes
exactly its output. A test asserts the persisted entity set equals the computed
set, and that decoys remain excluded after persistence.

### Requirement 9 — cross-sector coupling audit

Grepped the engine, query, authz, and persistence layers for school
vocabulary. **No school terms appear in any engine logic** — the only matches
were prose comments, the `class` keyword, and the `ClaimClass` type.

Genuine coupling found, in exactly one production module:

| Location | Coupling | Severity |
|---|---|---|
| `src/lib/graph/seed.ts` | Imports `domain/education/seed-data` directly; `seedEducationGraph()` and `SEED_VERSION = "edu-v1"` are education-specific | **Real** — blocks a second pack |
| `src/lib/runs/persist.ts` | Imports `SEED_VERSION` from `graph/seed`, inheriting the education constant | **Real**, follows from the above |
| `scripts/*`, `tests/*` | Import `SCENARIO_ROOT_ENTITY_ID` from the education pack | Acceptable — demo and test code |

**Fix when the second pack lands (deliberately NOT done now):** invert the
dependency so `seed.ts` takes a `DomainPack` argument (`{ domain, seedVersion,
sources, entities, dependencies }`) instead of importing one, and have
`persist.ts` read `seedVersion` from the run's inputs rather than a module
constant. The engine, queries, and authz layers need **no** change — they are
already sector-agnostic.

### Requirement 13 — DNS diagnosis: CONCLUSIVE

`scripts/dns-watch.ts`, 28 samples over ~12 minutes, sampling three layers
independently (DNS → TCP → FalkorDB query) and attributing each failure to the
lowest failing layer.

| Metric | Result |
|---|---|
| Attempts | 28 |
| Successes | 26 |
| Failures | 2 (**7.1%**) |
| **DNS-layer failures** | **2** |
| TCP-layer failures | **0** |
| Query-layer failures | **0** |
| Error codes | `ENOTFOUND` ×2 |
| DNS latency avg / max | 623 ms / **12,075 ms** |
| TCP latency avg / max | 1,351 ms / 3,876 ms |
| Query latency avg / max | 5,303 ms / 19,346 ms |
| Classification | **INTERMITTENT, DNS resolution only** |

**Conclusion:** this is **not** a FalkorDB problem. Once the hostname
resolves, TCP and the database succeeded **100% of the time**. The fault is
local DNS resolution of the cloud hostname.

Both failures were **isolated single samples** — the next attempt ~20–30s
later succeeded. One failed instantly (2 ms, consistent with a negative DNS
cache); the other failed after a 12 s resolver timeout.

**Evidence-driven change (not speculation):** the Stage 1 retry budget was 4
attempts over 3.5 s, which cannot cross a ~20–30 s negative-DNS window. It is
now 6 attempts with 1/2/4/8/16 s backoff (31 s total), calibrated to the
measured recovery time. A genuinely dead instance still fails, 31 s later.
This change took the suite from 15 failures to 0 on the next run.

Hosting, network configuration, and the database were **not** altered.

### Bug found and fixed — unhandled socket error crashed the process

The first diagnosis run **died** with an unhandled `'error'` event:

```
Error: read ECONNRESET
Emitted 'error' event on FalkorDB instance at: falkordb/dist/src/falkordb.js:49
```

`FalkorDB` extends `EventEmitter`, and Node re-throws an `'error'` event that
has no listener, terminating the process. Any idle-socket reset in production
would have killed the server.

**Fix:** `getDb()` now attaches an `error` listener that records the redacted
fault via `getLastSocketError()` instead of crashing. Re-run completed all 28
samples with 0 unhandled resets.

### Performance note for deployment

Cold connect + auth + a trivial query averaged **5.3 s** (max 19.3 s). Well
inside Vercel's 300 s limit, but it makes connection reuse essential rather
than merely nice — reinforcing the existing cached-connection design.

### Stage 2A verification

| Check | Result |
|---|---|
| `npx vitest run` | **152 passed / 152**, 0 skipped, 7 files (final run) |
| `npx tsc --noEmit` | clean, strict + `noUncheckedIndexedAccess` |
| `npx next build` | exit 0, 2 static routes |
| `npx tsx scripts/smoke-runs.ts` | SMOKE PASSED, 17/17 checks |
| Stage 1 regression | all 41 original tests still pass |

Verified test counts by file (from the JSON reporter, not estimated):

| File | Tests | Type |
|---|---|---|
| `impact.test.ts` | 21 | integration (real DB) |
| `connection-and-readonly.test.ts` | 12 | integration (real DB) |
| `seed-idempotency.test.ts` | 8 | integration (real DB) |
| `runs-persistence.test.ts` | 23 | integration (real DB) |
| `runs-authz.test.ts` | 22 | integration (real DB) |
| `depth-validation.test.ts` | 49 | **unit (client mocked, labelled as such)** |
| `token-transport.test.ts` | 17 | **unit (pure functions)** |
| **Total** | **152** | 86 integration, 66 unit |

**Stage 1 regression:** the three original files still total exactly **41**
tests (21 + 12 + 8), all passing. No Stage 1 test was weakened or removed.

### Test-suite flakiness — stated honestly

The suite is **not reliably green on every run**, and the cause is the DNS
fault above, not a defect in the code:

Four full-suite runs on identical code (after the retry fix, except the first):

| # | Run | Result |
|---|---|---|
| 1 | Before retry recalibration | 15 failed / 137 passed |
| 2 | After recalibration | **152 passed / 152** |
| 3 | JSON-reporter run | 127 passed, **3 failed**, 22 skipped |
| 4 | Final verification run | **152 passed / 152** |

Run 3's three failures were all in `impact.test.ts`, which reported an absurd
14,554 s file duration — a DNS stall, not an assertion failure. Re-running
that file alone gave **21/21 passing**, confirming no regression from the
Stage 2A changes to `impact.ts` and `queries.ts`.

So: roughly **2 of 4 full runs fail** for environmental reasons. The 31 s
retry budget reduces but does **not** eliminate the exposure — the suite takes
3.5–5.5 minutes and Vitest isolates each test file in its own module context,
so every file re-resolves DNS. Five integration files means five independent
chances to hit a ~7% fault per run.

**This is a demo risk, not just a CI annoyance.** It is recorded here rather
than hidden behind a re-run.

---

## 2026-10-15 — Stage 2B: evidence correctness, action proposals, audit

### Priority 1 — the Codex finding was correct, and it was a real bug

Stage 2A assigned `claim: "OBSERVED"` **unconditionally** to every impacted
entity. That was wrong in two distinct ways:

1. A three-hop reachability conclusion is **not** an observation. No record in
   the graph states "the WAEC mock depends on Okonkwo" — the engine *derived*
   it by chaining three relationships.
2. An entity whose edge cited a non-existent source was still reported
   OBSERVED, i.e. an **unsupported conclusion presented as a directly
   evidenced fact**. This is precisely the failure mode the project exists to
   avoid.

**Fix.** Evidence is now assessed per *edge*, because a route is only as
supported as its weakest link. Two independent axes are reported:

| Axis | Meaning |
|---|---|
| `claim` | OBSERVED = one relationship, evidence resolves. DERIVED = chained conclusion. |
| `evidenceStatus` | COMPLETE / PARTIAL / MISSING across the chosen route. |
| `supported` | false whenever the best route has unresolved evidence. |
| `unresolvedSourceIds` | explicit list of dangling references and uncited edges. |

A one-hop dependency whose evidence does **not** resolve degrades to DERIVED
and `supported: false` — it is not an observed fact.

`classifyExposure()` picks the **best-evidenced** route (ties broken by
shortest), which is the strongest honest claim available.
`assertVerifiableOnlyIfSupported()` makes "an unsupported conclusion may never
be VERIFIED" an enforced invariant rather than a comment.

**Measured effect on the demo scenario:** 4 OBSERVED (all genuinely 1-hop,
fully evidenced) and 6 DERIVED, where previously all 10 were mislabelled
OBSERVED.

Evidence tests use a fixture with a deliberately dangling `src_DANGLING`
reference and an edge citing no source at all, proving PARTIAL and MISSING are
detected and that no evidence record is ever fabricated.

### Priority 2 — action proposals

`:ActionProposal` nodes, generated by two deterministic versioned rules:

- `rule.action.cover-direct-dependency@1` — fires for entities one
  relationship from the change (4 proposals on the demo seed).
- `rule.action.resolve-evidence-gap@1` — fires only where evidence does not
  resolve. **Produces zero proposals on the clean seed**, which is the correct
  data-driven outcome rather than a guaranteed talking point.

Both rules reason about graph structure only — hop counts and evidence status
— so they carry no school vocabulary and would run unchanged on another pack.

Proposals link to the run (`PROPOSED_IN`), the justifying finding
(`ADDRESSES`), and the target entity (`TARGETS`). The `ADDRESSES` edge requires
the Finding to exist, so a proposal can never attach to a finding that was not
actually computed. Every proposal carries `claim: ASSESSED` — a recommendation
is a judgment, never an observation.

### Priority 3 — append-only audit, and approval is NOT execution

Implemented **only** `PROPOSED -> APPROVED` and `PROPOSED -> REJECTED`.
REVIEWED, EXECUTED and VERIFIED are deliberately absent: the system cannot
perform or confirm a real-world action, and modelling states it cannot honour
would encode a lie in the schema. A test asserts no other state is ever
persisted, and another asserts no `executedAt` / `verifiedAt` / `completedAt`
field exists on any proposal.

Authority is recorded as `DEMO_RUN_OWNER`, meaning exactly "whoever held the
run's owner token clicked approve in a demonstration". Not a person, not an
authenticated identity, not institutional authority. `APPROVAL_SEMANTICS` is
exported as data so a future UI cannot quietly drop the caveat, and every
transition returns `executed: false`.

**One statement enforces everything:**

```cypher
MATCH (run:AnalysisRun {analysisRunId:$runId, ownerTokenHash:$hash})  -- ownership
MATCH (p:ActionProposal {proposalId:$proposalId})-[:PROPOSED_IN]->(run)  -- belongs to THIS run
WHERE p.state = $fromState                                            -- expected prior state
SET p.state = $toState, ...
CREATE (a:AuditEvent {...})
MERGE (a)-[:ABOUT_PROPOSAL]->(p)
```

State change and audit event are written together, so they cannot disagree —
asserted both ways (no audit without a proposal, no decided proposal without
an audit). A repeated transition finds `state <> 'PROPOSED'`, matches nothing,
and therefore creates **no duplicate event**.

A subtlety worth recording: zero rows is ambiguous between "not authorized"
and "wrong state". The handler disambiguates with a follow-up read so an
invalid transition is not misreported as an auth failure.

### Priority 4 — encapsulating write access

`src/lib/actions/actions.ts` imports `roQuery` and `withRunAuthorization`
only. It has **no** `writeQuery` or `dropGraph` access, so every mutation an
action handler can perform is ownership-checked inside its own statement. A
test parses the module's real import statements (not prose) and also forbids
dynamic `await import(`, so this cannot silently regress. `writeQuery` remains
available to seeding and the documented admin pathway.

### Deferred — parallel edges (tested and documented, not repaired)

Two DEPENDS_ON edges between the same pair collapse into **one** stored route,
because path signatures are keyed on node ids rather than relationship ids.

| Property | Status |
|---|---|
| Distinct entity count | **correct** — counted once |
| Claim / evidence status | **correct** |
| `allPaths.length` | **under-reports** — 2 edges, 1 route |

**Not repaired** because a test confirms the education seed contains **zero**
parallel edges, so it cannot affect any demo finding. The fix is to key path
signatures on relationship ids.

### Single-organization limitation

The graph models **one synthetic organization**. There is no tenant boundary:
`:Entity` nodes form a single organizational space, and run-scoped
authorization protects *runs*, not organizational data. Multi-organization
support would need a tenant key on every node plus tenant-scoped traversal.
Out of scope.

### Deployment check — Vercel

Verified 2026-10-15 against
<https://vercel.com/docs/functions/configuring-functions/duration>.

- Next.js App Router sets duration with a named export in the route file:
  `export const maxDuration = 60;`
- **Hobby: 300 s default and 300 s maximum.** Pro: 300 s default, 800 s max.
- Project default is overridable at **Settings → Functions → Function Max
  Duration**, or via a `functions` glob in `vercel.json`.
- On overrun Vercel returns 504 `FUNCTION_INVOCATION_TIMEOUT`.

**The 31 s retry budget is NOT yet proven safe in deployment.** Measured
worst case is ~19 s cold connect plus up to 31 s of retry backoff, so a single
unlucky request could approach ~50 s. That fits inside 300 s *if* the project
default is actually 300 s — unverified for this account.

Independent of the limit, a 31 s in-request stall is poor UX. Recommendation
for the HTTP layer (not implemented — there is no route yet): use a **short
per-request budget (~2 attempts, ~3 s)** and surface a retry control, keeping
the long budget for seeding and scripts.

**Must be checked manually in the NexusForge Vercel project (account-specific,
not inferable from docs):**

1. Plan tier (Hobby vs Pro).
2. Settings → Functions → **Function Max Duration** actual value.
3. Environment variables present (the five `FALKORDB_*` names plus `FALKORDB_GRAPH`).
4. Fluid compute enabled (affects defaults).
5. Region vs the FalkorDB instance region (`us-east-1`) — cross-region adds latency.
6. Confirm the LessonForge project is untouched.

No Vercel project was created, connected, deployed, or modified.

### Stage 2B verification

| Check | Result |
|---|---|
| `npx vitest run` | **211 passed / 211**, 10 files, 0 skipped, 0 failed |
| `npx tsc --noEmit` | clean |
| `npx next build` | exit 0 |
| `scripts/smoke-actions.ts` | SMOKE PASSED, 22/22 |
| Regression | all prior suites still pass; two assertions **corrected**, not weakened |

The two changed assertions previously encoded the blanket-OBSERVED bug. They
now assert the stricter, correct rule (OBSERVED implies 1 hop *and* complete
evidence) and additionally require both claim classes to be present.

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
