# NexusForge

**A cross-sector organizational intelligence engine built on FalkorDB.**

Entry for [Graph Hacks 2026](https://www.wemakedevs.org/hackathons/falkordb)
(WeMakeDevs × FalkorDB) — targeting **Track 01: Agents That Act on Connected
Data** and **Track 03: Company Brain**.

**Live: <https://nexusforge-ten.vercel.app>**

> Everything described under "What actually works" is backed by tests that run
> against a real FalkorDB instance. Nothing else is claimed.

---

## What it does

Organizations are dependency graphs. When something changes — a person leaves,
a system is deprecated, a supplier fails — the hard question is not *what
happened* but *what is now exposed, why, and on what evidence*.

NexusForge answers:

1. What changed?
2. What is affected?
3. Why is it affected? *(the actual dependency path)*
4. What evidence supports that? *(a real source record with an excerpt)*

It is deliberately **not** a school management app. Education is the first
demonstration domain; the reasoning engine contains no school vocabulary.

### The flagship demonstration — Northstar Labs

> *"If Northstar Labs' AI inference gateway becomes unavailable, what is
> exposed, and what blocks a safe recovery?"*

Rooted at the gateway, the engine discovers **10 distinct exposed entities via
12 dependency paths** in ~40 ms.

The finding that matters is four hops away and has **no direct edge** to the
gateway:

```
Meridian Health MSA clause 8.2
  -> quarterly compliance evidence
    -> audit event processor
      -> inference.events (topic)
        -> AI Inference Gateway
```

An enterprise contract is exposed by an inference outage, through an
asynchronous event topic nobody would check first. The traversal finds it; a
service-dependency list would not.

The same scenario also demonstrates what the system refuses to do:

- **An ownership gap.** The on-call assignment covering failover points at an
  engineer who left, with no deputy recorded. NexusForge reports the
  unresolved responsibility and does **not** invent a replacement.
- **An uncertain recovery constraint.** The external failover plan cites an
  architecture decision whose current status cannot be found, so the finding
  is marked `MISSING` evidence and `supported: false` — one hop away, but
  deliberately **not** `OBSERVED`. The proposed action is to close the gap,
  not to route around it.
- **Decoys.** Billing and model-registry services are plausible neighbours in
  an AI company. They have no dependency route to the gateway and are
  excluded.

### Secondary demonstration — education

A synthetic school (`Northgate Secondary School`) runs on the **same engine
with zero changes**: 10 entities via 13 paths from a resigning physics
teacher, with an `SS1 Physics` decoy correctly excluded. It exists to prove
the engine is not sector-specific, and doubles as a regression fixture.

Organizations are **isolated in separate FalkorDB graphs**. The browser sends
an allowlisted organization id and can never supply a graph name.

---

## The role of FalkorDB

FalkorDB is the **only** datastore. There is no PostgreSQL, SQLite, separate
Redis store, or JSON persistence layer. Entities, relationships, and evidence
are all nodes and edges.

The graph does the real work: impact discovery is a bounded, cycle-safe,
multi-hop Cypher traversal, not a filter over a list. **If FalkorDB is
unavailable the system fails honestly** — there is no in-memory fallback
pretending to be a graph database, and no mocked FalkorDB anywhere in the test
suite.

---

## What actually works

### IMPLEMENTED AND TESTED (real database)

**Graph reasoning (Stage 1)**
- Connection to FalkorDB Cloud with Zod-validated configuration
- Deterministic, **idempotent** seeding — verified over three consecutive runs
- Bounded multi-hop dependency traversal via parameterized Cypher
- **Decoy exclusion** — similar vocabulary, no dependency path, correctly omitted
- **Provenance** — every impacted entity resolves to a real `:Source` node
- **Multiple-path handling** — an entity reached by 3 routes counts once, with
  all routes inspectable
- **Cycle safety** — a deliberate cycle produces a stable, bounded result
- `GRAPH.RO_QUERY` write rejection, verified for `CREATE`/`SET`/`DELETE`/`MERGE`
- Graph-namespace ownership guard (`nf_` prefix enforced at the client boundary)
- Re-seed pathway for a missing graph
- Independent re-check query that cross-validates the distinct-entity count

**Durable analysis runs (Stage 2A)**
- `:AnalysisRun` and `:Finding` nodes persisted in FalkorDB, with the
  traversed relationship ids, path signatures, and evidence references
- Findings survive a fresh application connection
- **Run isolation** — concurrent runs never overwrite each other's findings
- **Idempotent retries** — re-persisting a run creates no duplicates, while
  `persistAttempts` distinguishes a retry from a new analysis
- **Run-scoped authorization** — an opaque owner token, SHA-256 hashed at rest,
  enforced *inside* the mutating Cypher statement (no check-then-write race)
- Rejected mutations provably change nothing
- **Strict depth validation** — fractions, negatives, zero, out-of-range, NaN,
  Infinity, and all string input rejected before any Cypher is constructed

**Interface and API (Stage 3)**
- Five server routes: health, entities, analysis, run read, proposal decision,
  plus `ask` and `agent`
- Investigation UI with a hop-column canvas, **real directed edges** keyed by
  actual `DEPENDS_ON` relationship ids, Trace highlighting, and an Inspector
  showing the Cypher template, parameters and verbatim evidence
- **Organization isolation** — one FalkorDB graph per organization, resolved
  through a server-side allowlist; the browser never supplies a graph name
- **Ask NexusForge** — suggested questions generated from the loaded graph,
  plus free text, answered deterministically without a language model
- Constrained agent loop with typed Zod-validated tools, budgets, timeouts and
  a kill switch; **no tool can approve, reject or run Cypher**

**Action workflow (Stage 2B)**
- **Correct claim classification** — `OBSERVED` only for a single relationship
  backed by resolving evidence; transitive conclusions are `DERIVED`
- **Explicit evidence gaps** — `COMPLETE` / `PARTIAL` / `MISSING`, with
  dangling references listed, and an enforced invariant that an unsupported
  conclusion can never be marked verified
- `:ActionProposal` nodes from deterministic versioned rules, linked to the
  run, the justifying finding, and the target entity
- `PROPOSED → APPROVED | REJECTED` only, with run-scoped authorization and the
  expected prior state enforced inside one statement
- Append-only `:AuditEvent` per successful transition, consistent with state
  and never duplicated on retry

### NOT IMPLEMENTED (deliberately)

Qualification and availability rules · replacement-candidate ranking ·
contradiction detection · enterprise identity or role-based authorization ·
external action execution.

**The OpenAI planner is built but disabled by default.** It requires both a
key and `NF_AGENT_LLM=on`, so a key alone can never start billing. The
deployed site runs the deterministic path only. One controlled paid test was
run locally against `gpt-6-luna`: 5 model requests, 4,711 tokens, 32.7s, and
the safety invariants held.

**Explicitly NOT modelled:** `REVIEWED`, `EXECUTED`, and `VERIFIED` proposal
states. NexusForge performs no external action and cannot confirm one, so
those states would be a lie encoded in the schema.

> **Approval is not execution.** An approved proposal records that a demo run
> owner decided to proceed. Nothing has been executed, scheduled,
> communicated, or verified. Every transition returns `executed: false`.

**This is demonstration isolation, not enterprise multitenancy.** There is no
per-user identity, and an operator with instance credentials can read every
graph.

---

## Setup

### Requirements

Node.js 22+ and a FalkorDB instance (Cloud free tier is sufficient).

### 1. Install

```bash
npm install
```

### 2. Configure

Copy `.env.example` to `.env.local` and fill in your instance details:

| Variable | Required | Notes |
|---|---|---|
| `FALKORDB_HOST` | yes | Instance hostname |
| `FALKORDB_PORT` | yes | Instance port |
| `FALKORDB_USERNAME` | yes | Defaults to `default` |
| `FALKORDB_PASSWORD` | yes | |
| `FALKORDB_TLS` | no | `false` on the Cloud free tier, which has no TLS |
| `FALKORDB_GRAPH` | no | Fallback graph. Per-organization graphs come from the server-side allowlist in `src/lib/org/registry.ts`. **Must start with `nf_`.** |
| `OPENAI_API_KEY` | no | Only needed for the optional model planner. |
| `NF_AGENT_LLM` | no | `on` enables the model planner. Default `off`. |
| `NF_AGENT_ENABLED` | no | `false` is a kill switch for all agent activity. |

`.env.local` is gitignored and must never be committed.

### 3. Run

```bash
npm run graphs:list   # read-only inventory of graphs on the instance
npm run seed          # seed the synthetic graph (safe to re-run)
npm run impact        # run the impact analysis and print the result
npm test              # 41 integration tests against the real database
npm run typecheck     # strict TypeScript
npm run build         # production build
npm run dev           # placeholder page at http://localhost:3000
```

Two diagnostic scripts are also available:

```bash
npx tsx scripts/probe.ts                 # full feasibility probe, self-cleaning
npx tsx scripts/diagnose-connection.ts   # network/DNS diagnosis, masks hostnames
```

---

## Graph model

Full detail in **[docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md)**. In brief:

- `:Entity` — any organizational thing. Single label + a `type` property, so
  the engine stays sector-agnostic.
- `:Source` — an evidence record with a `reference` and a verbatim `excerpt`.
- `(dependent)-[:DEPENDS_ON]->(dependency)` — **edges point from the thing that
  depends to the thing it depends on.** Impact traversal walks them in reverse.
- `(:Entity)-[:EVIDENCED_BY]->(:Source)` — provenance.

`edgeHops` (relationships traversed) and `entityHops` (meaningful
organizational transitions) are reported separately and never conflated.

### The central query

```cypher
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
  AND ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
RETURN affected.id                          AS entityId,
       [n IN nodes(p) | n.id]               AS pathIds,
       [r IN relationships(p) | r.sourceId] AS pathSourceIds,
       length(p)                            AS edgeHops
ORDER BY entityId, edgeHops, pathIds
```

The `ALL(...)` predicate enforces node-distinctness, which is what keeps a
cyclic subgraph from producing misleading trails.

---

## Analysis runs and authorization

Every analysis is a durable, inspectable run.

```
(:Finding)-[:PART_OF_RUN]->(:AnalysisRun)
(:Finding)-[:ABOUT]->(:Entity)
(:Finding)-[:CITES]->(:Source)
```

A run records its input event, depth bound, rule id, seed version, status, and
counts. A finding records the affected entity, claim class, rule version, the
**relationship ids actually traversed**, every alternative path signature, and
its evidence source ids.

Run and finding data live on their own labels. Persisting a run **never**
modifies organizational data — asserted by comparing a full fingerprint of
every `:Entity` and `:DEPENDS_ON` edge before and after.

### Owner tokens

An `analysisRunId` is an identifier, **not a credential**. Mutating a run also
requires an opaque `ownerToken` (32 random bytes), returned exactly once when
the run is created. Only its SHA-256 hash is stored.

Authorization is enforced *inside* the mutating statement:

```cypher
MATCH (run:AnalysisRun {analysisRunId: $runId, ownerTokenHash: $ownerTokenHash})
<mutation>
```

If the match binds nothing, the mutation never runs — there is no separate
check-then-write step and therefore no race. Every run mutation funnels through
`withRunAuthorization`.

> An owner token proves only that the caller created the run. It is **not**
> proof of human identity, and **not** authority to perform a business action.
> Action-specific approval authority is Stage 2B.

## Claim classification

| Label | Meaning | Used for |
|---|---|---|
| `OBSERVED` | A **single** relationship, backed by evidence that resolves | direct dependencies |
| `DERIVED` | Computed by chaining relationships under a versioned rule | transitive exposure |
| `ASSESSED` | Judgment or interpretation | action proposals |

Evidence support is tracked **separately** from claim class, because they
answer different questions — *how* a statement was reached versus *whether it
is supported*:

| `evidenceStatus` | Meaning |
|---|---|
| `COMPLETE` | every traversed edge cites a source that exists |
| `PARTIAL` | some edges resolve, some do not |
| `MISSING` | no edge on the route resolves |

A one-hop dependency whose evidence does **not** resolve is not an observed
fact: it degrades to `DERIVED` with `supported: false`. An unsupported
conclusion can never be marked verified — that invariant is enforced in code,
not just documented.

> **A dependency path proves exposure to a change, not operational failure.**
> The engine does not assign severity, declare anything "at risk", or infer
> eligibility. Those would be judgments, and fabricating them is the specific
> failure mode this project is built to avoid.

---

## Synthetic data notice

**All demonstration data is synthetic.** No real person, school, document, or
examination is represented. Every seeded node carries `synthetic: true`. The
names, registers, rosters, and minutes are invented for this demonstration.

---

## Known limitations

1. **No UI.** CLI and tests only.
2. **No agent or LLM integration yet.** The system is purely deterministic.
3. **Run ownership is not identity.** An owner token proves only that the
   caller created the run. It is not authentication, and not authority to
   approve a business action. Stage 2B must add that.
4. **Seeding is recoverable, not atomic.** FalkorDB executes each query
   atomically, but the seed spans five statements with no cross-statement
   transaction. Every statement is `MERGE`-keyed so re-running repairs a
   partial seed, and a `SeedMarker` written last makes partial state
   detectable. We do not claim atomicity.
5. **Free tier has no TLS** (verified in FalkorDB docs). Credentials cross the
   network unencrypted — acceptable for synthetic demo data only.
6. **Free-tier idle behaviour unverified.** The instance may be stopped or
   reclaimed; `ensureSeeded()` exists to rebuild. Our planning assumed two
   pre-existing graphs on the instance — there were actually **zero**.
7. **Intermittent DNS failures** resolving the Cloud hostname. A 28-sample
   diagnosis measured a **7.1% failure rate, entirely at the DNS layer** —
   zero TCP and zero database failures once the name resolved. Mitigated with
   a 31 s retry budget calibrated to the measured recovery time, but **not
   eliminated**: the test suite still fails intermittently for this reason,
   and a live demo could stall on first load. See `docs/LOG.md`.
8. **Cold connect latency averages ~5 s** (max 19 s) to the free-tier
   instance, so connection reuse is essential.
9. **Single domain pack.** The engine, queries, and authorization layers are
   sector-agnostic (audited — no school vocabulary). The one real coupling is
   `src/lib/graph/seed.ts`, which imports the education pack directly; that
   dependency must be inverted when a second pack lands.
10. **No HTTP surface.** The owner-token cookie transport is designed and unit
    tested but deliberately not wired to any route.
11. **Single synthetic organization.** There is no tenant boundary. Run-scoped
    authorization protects *runs*, not organizational data; multi-organization
    support would need a tenant key on every node and tenant-scoped traversal.
12. **Parallel edges under-report routes.** Two `DEPENDS_ON` edges between the
    same pair collapse to one stored path, because signatures key on node ids.
    Entity counts, claims, and evidence stay correct. Tested and documented;
    not repaired, because the education seed provably contains none.
13. **The 31 s retry budget is unproven in deployment.** Worst case is ~19 s
    cold connect plus 31 s backoff. It fits Hobby's 300 s limit on paper, but
    has not been tested from a real Vercel request, and a 31 s in-request
    stall is poor UX. A short per-request budget is recommended for the HTTP
    layer.

---

## AI assistance disclosure

Per the hackathon rules, which require disclosure of AI assistant use:

This project was built with **Claude Code (Anthropic)** acting as implementing
engineer, under the direction of the project owner, who specified the
architecture, constraints, and acceptance criteria, and who reviews the work.
AI assistance covered scaffolding, Cypher and TypeScript implementation, test
authoring, and documentation. All test results reported here come from actual
execution against a real FalkorDB instance.

---

## Documentation

- **[docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md)** — graph schema, queries, design rationale
- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — verified hackathon requirements with sources
- **[docs/LOG.md](docs/LOG.md)** — engineering log, experiment results, mistakes and fixes
