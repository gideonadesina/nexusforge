/**
 * Fixed Cypher templates.
 *
 * Every query here is parameterized. No caller -- and later, no LLM -- may
 * supply raw Cypher. The single exception to full parameterization is the
 * variable-length upper bound in the traversal pattern: openCypher does not
 * permit a parameter inside `*1..n`, so the bound is validated as a small
 * integer and interpolated by `impactQuery()` below. Nothing else is ever
 * interpolated.
 */

/** Hard ceiling on traversal depth, independent of caller input. */
export const MAX_TRAVERSAL_DEPTH = 8;

export function assertDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_TRAVERSAL_DEPTH) {
    throw new Error(
      `Traversal depth must be an integer in 1..${MAX_TRAVERSAL_DEPTH}, received ${String(depth)}.`,
    );
  }
  return depth;
}

/**
 * Downstream-impact traversal.
 *
 * Dependency edges point dependent -> dependency, so everything exposed to a
 * change in `root` is found by walking DEPENDS_ON *into* the root.
 *
 * Cycle safety is enforced in three independent ways:
 *  1. the bounded `*1..depth` pattern,
 *  2. openCypher relationship-uniqueness (no edge repeats within one path),
 *  3. the explicit node-distinctness predicate below, which rejects trails
 *     that revisit a node via different edges -- exactly what a governance
 *     cycle produces.
 *
 * Returns one row per distinct route. Collapsing routes to distinct entities
 * is done in application code so that alternative evidence paths stay
 * inspectable (architecture 2.4 / Guardrail 4).
 */
export function impactQuery(depth: number): string {
  const d = assertDepth(depth);
  return `
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..${d}]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
  AND ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
RETURN affected.id                              AS entityId,
       affected.type                            AS entityType,
       affected.name                            AS entityName,
       [n IN nodes(p) | n.id]                   AS pathIds,
       [n IN nodes(p) | n.type]                 AS pathTypes,
       [n IN nodes(p) | n.name]                 AS pathNames,
       [n IN nodes(p) | n.intermediary]         AS pathIntermediary,
       [r IN relationships(p) | r.sourceId]     AS pathSourceIds,
       [r IN relationships(p) | r.kind]         AS pathKinds,
       length(p)                                AS edgeHops
ORDER BY entityId, edgeHops, pathIds
`.trim();
}

/** Fetch the root entity. Used to fail loudly when the scenario root is absent. */
export const GET_ENTITY = `
MATCH (e:Entity {id: $id})
RETURN e.id AS id, e.type AS type, e.name AS name, e.intermediary AS intermediary
`.trim();

/** Resolve evidence records referenced by traversal rows. */
export const GET_SOURCES = `
UNWIND $ids AS sid
MATCH (s:Source {id: sid})
RETURN s.id AS sourceId, s.reference AS reference, s.excerpt AS excerpt,
       s.sourceType AS sourceType
`.trim();

/**
 * Independent deterministic re-check (architecture 2.5).
 *
 * Counts distinct reachable entities with a different formulation from
 * `impactQuery` -- no path binding, no node-distinctness predicate, just
 * reachability. If this disagrees with the engine's distinct count, one of the
 * two is wrong and the discrepancy must be investigated rather than smoothed
 * over.
 */
export function recheckDistinctCountQuery(depth: number): string {
  const d = assertDepth(depth);
  return `
MATCH (affected:Entity)-[:DEPENDS_ON*1..${d}]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
RETURN count(DISTINCT affected.id) AS distinctCount
`.trim();
}

/** Graph census, used by the idempotency check. */
export const COUNT_ENTITIES = `MATCH (n:Entity) RETURN count(n) AS c`;
export const COUNT_SOURCES = `MATCH (n:Source) RETURN count(n) AS c`;
export const COUNT_DEPENDS_ON = `MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c`;
export const COUNT_EVIDENCED_BY = `MATCH ()-[r:EVIDENCED_BY]->() RETURN count(r) AS c`;

/** Stable identifier census: detects duplicate logical records after re-seed. */
export const ENTITY_ID_CENSUS = `
MATCH (n:Entity)
RETURN n.id AS id, count(n) AS occurrences
ORDER BY id
`.trim();

export const DEPENDENCY_ID_CENSUS = `
MATCH ()-[r:DEPENDS_ON]->()
RETURN r.id AS id, count(r) AS occurrences
ORDER BY id
`.trim();

/** Marker written last by the seed, so a partial seed is detectable. */
export const GET_SEED_MARKER = `
MATCH (m:SeedMarker {id: 'seed_marker'})
RETURN m.seedVersion AS seedVersion, m.domain AS domain, m.complete AS complete
`.trim();
