# NexusForge Graph Model

FalkorDB is the **only** datastore. Entities, relationships, and source
evidence all live here as nodes and edges. There is no second database, no
JSON store, and no in-memory graph.

## Design principle: the engine is sector-agnostic

The reasoning engine knows about **entities**, **dependencies**, and
**evidence**. It does not know what a teacher or a class is. Domain vocabulary
lives in the `type` property and in the domain pack
(`src/domain/education/seed-data.ts`), never in the traversal logic.

That is why nodes use a single `:Entity` label with a `type` property rather
than `:Teacher`, `:Class`, and so on — swapping in a logistics or healthcare
pack requires new seed data, not a new query engine.

## Node labels

### `:Entity`

Any organizational thing: a person, class, assignment, timetable slot,
responsibility, committee, examination.

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Stable identifier. Unique. Indexed. The MERGE key. |
| `type` | string | Domain-pack vocabulary, e.g. `Person`, `Class`, `Examination`. |
| `name` | string | Human-readable label. |
| `intermediary` | boolean | `true` when the node reifies a relationship rather than being a standalone thing (see below). |
| `domain` | string | Domain pack that produced it, e.g. `education`. |
| `synthetic` | boolean | Always `true`. All demonstration data is synthetic. |

### `:Source`

An evidence record. Deliberately minimal — this is **not** a document
management subsystem.

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Stable identifier. Indexed. |
| `reference` | string | Citation, e.g. "Staff teaching register, Term 1 2026/2027, page 3". |
| `excerpt` | string | Verbatim supporting text. |
| `sourceType` | string | e.g. `resignation_letter`, `timetable`, `duty_roster`. |
| `synthetic` | boolean | Always `true`. |

### `:SeedMarker`

A single node written **last** by the seed, carrying `seedVersion`, `domain`,
and `complete: true`. Its presence is how a partial seed is detected.

## Relationships

### `(dependent)-[:DEPENDS_ON]->(dependency)`

**The direction rule, which everything else follows:** an edge points
**from the thing that depends, to the thing it depends on**.

```
SS3 Physics  -[:DEPENDS_ON]->  Teaching assignment  -[:DEPENDS_ON]->  A. Okonkwo
```

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Stable edge identifier. The MERGE key — this is what makes re-seeding idempotent. |
| `kind` | string | Domain flavour, e.g. `staffed_by`, `taught_under`. Never interpreted by the engine. |
| `sourceId` | string | The `:Source` attesting to this dependency. |

Because edges point toward what is depended upon, **impact traversal walks them
in reverse**: everything exposed to a change in X is found by matching paths
that arrive *at* X.

### `(:Entity)-[:EVIDENCED_BY]->(:Source)`

Entity-level provenance: the record attesting that this entity exists.

## `edgeHops` vs `entityHops`

These are **not** the same number and are never conflated.

- `edgeHops` — graph relationships traversed.
- `entityHops` — meaningful organizational transitions, computed by subtracting
  interior `intermediary` nodes.

An `Assignment` exists only to link a person to a duty, so:

```
SS3 Physics -> Teaching assignment -> A. Okonkwo
edgeHops   = 2   (two relationships)
entityHops = 1   (one real organizational transition: class depends on person)
```

## Claim classification

Every finding carries a claim label:

| Label | Meaning |
|---|---|
| `OBSERVED` | Directly represented in the graph with source evidence. |
| `DERIVED` | Computed by a named, versioned rule from observed facts. |
| `ASSESSED` | Judgment or interpretation. Any AI-authored assessment must use this. |

Stage 1 emits only `OBSERVED`. The dependency chain and its evidence are
present in the graph, so exposure is an observation. **No severity, failure, or
eligibility judgment is produced** — those would be assessments, and inventing
them is exactly the failure mode this project exists to avoid.

> A dependency path proves **exposure** to a change. It does not prove
> operational failure. Connectivity is not consequence.

## The seeded demonstration graph

17 entities, 7 sources, 17 `DEPENDS_ON` edges, 18 `EVIDENCED_BY` edges.

Deliberately constructed features:

1. **A genuine multi-hop chain** — the WAEC mock exam reaches the resigning
   teacher only through intermediate nodes.
2. **Multiple routes to one entity** — the mock exam has **three** distinct
   routes; the lab-practical responsibility has **two**, of different lengths
   (1 and 2 hops). This is the relationship-uniqueness fixture.
3. **A deliberate cycle** — examinations committee ↔ science examinations
   coordination, to prove bounded traversal.
4. **Decoys** — `SS1 Physics` (same subject word, taught by a different
   teacher), plus a PE teacher, PE assignment, and athletics club. They share
   vocabulary but have **no dependency route** to the resigning teacher, so a
   keyword-matching system would wrongly include them and a graph traversal
   correctly excludes them.

### Verified result

Rooted at the resigning teacher (`ent_person_okonkwo`), depth bound 6:

- **10 distinct exposed entities**
- **13 dependency paths**
- Independent re-check query agrees on 10
- All decoys excluded
- Every impacted entity carries resolvable evidence

## The queries

All live in `src/lib/graph/queries.ts`. Full text there; the central one:

```cypher
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
  AND ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
RETURN affected.id                          AS entityId,
       affected.type                        AS entityType,
       affected.name                        AS entityName,
       [n IN nodes(p) | n.id]               AS pathIds,
       [n IN nodes(p) | n.type]             AS pathTypes,
       [n IN nodes(p) | n.name]             AS pathNames,
       [n IN nodes(p) | n.intermediary]     AS pathIntermediary,
       [r IN relationships(p) | r.sourceId] AS pathSourceIds,
       [r IN relationships(p) | r.kind]     AS pathKinds,
       length(p)                            AS edgeHops
ORDER BY entityId, edgeHops, pathIds
```

Notes:

- `$rootId` is parameterized. The depth bound **cannot** be — openCypher
  rejects a parameter inside `*1..n` — so it is validated as an integer in
  `1..8` by `assertDepth()` and interpolated. Nothing else is interpolated, and
  no caller may supply raw Cypher.
- The `ALL(...)` predicate enforces node-distinctness. Relationship-uniqueness
  alone still admits node-revisiting trails, which a cycle produces.
- Returns **one row per route**. Collapsing to distinct entities happens in
  application code so alternative evidence paths stay inspectable.

### Independent re-check

A differently formulated query used to cross-check the distinct count:

```cypher
MATCH (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
RETURN count(DISTINCT affected.id) AS distinctCount
```

If the two disagree, one is wrong — the test asserts they agree rather than
trusting either alone.

### Idempotent seed pattern

```cypher
UNWIND $rows AS row
MATCH (a:Entity {id: row.from})
MATCH (b:Entity {id: row.to})
MERGE (a)-[r:DEPENDS_ON {id: row.id}]->(b)
SET r.kind = row.kind, r.sourceId = row.sourceId
```

`MERGE` keyed on the stable `row.id` is what makes re-running safe.

## Safety

- **Graph namespace:** every graph this project touches must start with `nf_`,
  enforced in `assertOwnedGraph()` at the client boundary. Reads and writes to
  any other graph throw before reaching the server.
- **Read path:** all analysis queries use `GRAPH.RO_QUERY`. The server rejects
  writes on that channel — verified for `CREATE`, `SET`, `DELETE`, `MERGE`.
- **Timeouts:** every query carries a server-side `TIMEOUT`.
