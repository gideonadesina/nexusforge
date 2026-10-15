# NexusForge

**A cross-sector organizational intelligence engine built on FalkorDB.**

Entry for [Graph Hacks 2026](https://www.wemakedevs.org/hackathons/falkordb)
(WeMakeDevs × FalkorDB) — targeting **Track 01: Agents That Act on Connected
Data** and **Track 03: Company Brain**.

> **Stage 1 status.** This repository currently contains a *verified walking
> skeleton*, not a finished product. Everything described under "What actually
> works" below is backed by tests that run against a real FalkorDB instance.
> Nothing else is claimed.

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

### The demonstration scenario

> *"Our only SS2/SS3 physics teacher resigns effective Friday. What's affected?"*

Rooted at the resigning teacher, the engine discovers **10 distinct exposed
entities via 13 dependency paths** — classes, timetable slots, laboratory
responsibilities, the WAEC mock examination, and an examinations committee —
each with its traversal path and source evidence.

It **excludes** an `SS1 Physics` class that shares the subject name but is
taught by a different teacher. That exclusion is the point: a keyword search
would return it, a dependency traversal does not.

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

### IMPLEMENTED AND TESTED (real database, 41 passing tests)

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

### NOT IMPLEMENTED (deliberately — Stage 2)

Qualification and availability rules · replacement-candidate ranking ·
missing-data and contradiction detection · findings persisted as nodes ·
action proposals and approval workflow · audit records · analysis-run
isolation · LLM integration · any user interface · a second domain pack.

**There is no UI.** The page at `/` is a static placeholder. Stage 1 is
exercised from the CLI and the test suite.

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
| `FALKORDB_GRAPH` | no | Defaults to `nf_demo_education`. **Must start with `nf_`.** |

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

## Claim classification

| Label | Meaning |
|---|---|
| `OBSERVED` | Directly in the graph, with source evidence |
| `DERIVED` | Computed by a named, versioned rule |
| `ASSESSED` | Judgment or interpretation — any AI-written assessment |

Stage 1 emits only `OBSERVED`, tagged with the rule id
`rule.impact.dependency-reachability@1`.

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
2. **No agent or LLM integration yet.** Stage 1 is purely deterministic.
3. **Shared mutable graph.** No per-analysis isolation — concurrent users would
   interfere. Designed but deliberately deferred (see `docs/LOG.md`).
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
7. **Intermittent DNS failures** were observed resolving the Cloud hostname.
   Mitigated with bounded retry; not eliminated.
8. **Single domain pack.** Cross-sector reuse is designed for but not yet
   demonstrated with a second pack.

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
