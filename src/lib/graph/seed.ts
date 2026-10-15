import { writeQuery, roQuery, statOf } from "../falkor/client";
import {
  DOMAIN,
  SOURCES,
  ENTITIES,
  DEPENDENCIES,
  type SeedSource,
  type SeedEntity,
  type SeedDependency,
} from "../../domain/education/seed-data";
import { GET_SEED_MARKER } from "./queries";

/**
 * Deterministic, idempotent seeding of the synthetic demonstration graph.
 *
 * Idempotency strategy: every statement is MERGE-keyed on a stable id from the
 * domain pack, so re-running converges on the same graph rather than appending.
 *
 * Atomicity: FalkorDB executes each GRAPH.QUERY atomically, but the seed spans
 * several statements and there is NO cross-statement transaction. We therefore
 * do NOT claim atomicity. Instead the seed is *recoverable*: because each step
 * is idempotent and ordered (sources -> entities -> evidence -> dependencies ->
 * marker), a run that dies partway can be fixed by simply running it again. The
 * `SeedMarker` node is written last, so `complete: true` is only ever present
 * when every preceding step succeeded.
 */

export const SEED_VERSION = "edu-v1";

/** Counts used by the idempotency assertions. */
export interface GraphCensus {
  entities: number;
  sources: number;
  dependsOn: number;
  evidencedBy: number;
}

export interface SeedReport {
  graphName: string;
  seedVersion: string;
  census: GraphCensus;
  /** Nodes/relationships the server reported as newly created this run. */
  nodesCreated: number;
  relationshipsCreated: number;
  /** Expected counts derived from the domain pack, for comparison. */
  expected: GraphCensus;
}

function evidenceLinks(entities: SeedEntity[]): Array<{ entityId: string; sourceId: string }> {
  const links: Array<{ entityId: string; sourceId: string }> = [];
  for (const e of entities) {
    for (const sourceId of e.sourceIds) {
      links.push({ entityId: e.id, sourceId });
    }
  }
  return links;
}

/** Validate the domain pack before touching the database. */
export function validateSeedData(
  sources: SeedSource[] = SOURCES,
  entities: SeedEntity[] = ENTITIES,
  deps: SeedDependency[] = DEPENDENCIES,
): void {
  const sourceIds = new Set(sources.map((s) => s.id));
  const entityIds = new Set(entities.map((e) => e.id));

  if (sourceIds.size !== sources.length) throw new Error("Duplicate source id in seed data.");
  if (entityIds.size !== entities.length) throw new Error("Duplicate entity id in seed data.");

  const depIds = new Set(deps.map((d) => d.id));
  if (depIds.size !== deps.length) throw new Error("Duplicate dependency id in seed data.");

  for (const e of entities) {
    for (const sid of e.sourceIds) {
      if (!sourceIds.has(sid)) {
        throw new Error(`Entity ${e.id} references unknown source ${sid}.`);
      }
    }
  }
  for (const d of deps) {
    if (!entityIds.has(d.from)) throw new Error(`Dependency ${d.id} has unknown 'from' ${d.from}.`);
    if (!entityIds.has(d.to)) throw new Error(`Dependency ${d.id} has unknown 'to' ${d.to}.`);
    if (!sourceIds.has(d.sourceId)) {
      throw new Error(`Dependency ${d.id} references unknown source ${d.sourceId}.`);
    }
    if (d.from === d.to) throw new Error(`Dependency ${d.id} is a self-loop.`);
  }
}

/** Expected census implied by the domain pack. */
export function expectedCensus(): GraphCensus {
  return {
    entities: ENTITIES.length,
    sources: SOURCES.length,
    dependsOn: DEPENDENCIES.length,
    evidencedBy: evidenceLinks(ENTITIES).length,
  };
}

export async function census(graphName: string): Promise<GraphCensus> {
  const one = async (cypher: string): Promise<number> => {
    const r = await roQuery<{ c: number }>(graphName, cypher);
    return r.data[0]?.c ?? 0;
  };
  return {
    entities: await one(`MATCH (n:Entity) RETURN count(n) AS c`),
    sources: await one(`MATCH (n:Source) RETURN count(n) AS c`),
    dependsOn: await one(`MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c`),
    evidencedBy: await one(`MATCH ()-[r:EVIDENCED_BY]->() RETURN count(r) AS c`),
  };
}

/**
 * Create supporting indexes. Safe to call repeatedly: an "already indexed"
 * error is the expected outcome on re-runs and is swallowed deliberately.
 */
async function ensureIndexes(graphName: string): Promise<void> {
  const statements = [
    `CREATE INDEX FOR (n:Entity) ON (n.id)`,
    `CREATE INDEX FOR (n:Source) ON (n.id)`,
  ];
  for (const stmt of statements) {
    try {
      await writeQuery(graphName, stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already indexed|already exists/i.test(msg)) throw err;
    }
  }
}

/**
 * Seed (or re-seed) the synthetic education graph.
 *
 * Returns the real post-seed census read back from the database, not the
 * values we intended to write.
 */
export async function seedEducationGraph(graphName: string): Promise<SeedReport> {
  validateSeedData();

  let nodesCreated = 0;
  let relationshipsCreated = 0;

  await ensureIndexes(graphName);

  // 1. Sources first: entities and dependencies reference them.
  const sourcesRes = await writeQuery(
    graphName,
    `
UNWIND $rows AS row
MERGE (s:Source {id: row.id})
SET s.reference  = row.reference,
    s.excerpt    = row.excerpt,
    s.sourceType = row.sourceType,
    s.synthetic  = true
`.trim(),
    { params: { rows: SOURCES } },
  );
  nodesCreated += statOf(sourcesRes.metadata, "Nodes created");

  // 2. Entities.
  const entitiesRes = await writeQuery(
    graphName,
    `
UNWIND $rows AS row
MERGE (e:Entity {id: row.id})
SET e.type         = row.type,
    e.name         = row.name,
    e.intermediary = row.intermediary,
    e.domain       = $domain,
    e.synthetic    = true
`.trim(),
    {
      params: {
        domain: DOMAIN,
        rows: ENTITIES.map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
          intermediary: e.intermediary,
        })),
      },
    },
  );
  nodesCreated += statOf(entitiesRes.metadata, "Nodes created");

  // 3. Entity-level provenance.
  const evidenceRes = await writeQuery(
    graphName,
    `
UNWIND $rows AS row
MATCH (e:Entity {id: row.entityId})
MATCH (s:Source {id: row.sourceId})
MERGE (e)-[:EVIDENCED_BY]->(s)
`.trim(),
    { params: { rows: evidenceLinks(ENTITIES) } },
  );
  relationshipsCreated += statOf(evidenceRes.metadata, "Relationships created");

  // 4. Dependency edges, keyed on a stable edge id so MERGE cannot duplicate.
  const depsRes = await writeQuery(
    graphName,
    `
UNWIND $rows AS row
MATCH (a:Entity {id: row.from})
MATCH (b:Entity {id: row.to})
MERGE (a)-[r:DEPENDS_ON {id: row.id}]->(b)
SET r.kind     = row.kind,
    r.sourceId = row.sourceId
`.trim(),
    { params: { rows: DEPENDENCIES } },
  );
  relationshipsCreated += statOf(depsRes.metadata, "Relationships created");

  // 5. Completion marker LAST, so a partial seed is detectable.
  await writeQuery(
    graphName,
    `
MERGE (m:SeedMarker {id: 'seed_marker'})
SET m.seedVersion = $seedVersion,
    m.domain      = $domain,
    m.complete    = true,
    m.synthetic   = true
`.trim(),
    { params: { seedVersion: SEED_VERSION, domain: DOMAIN } },
  );

  return {
    graphName,
    seedVersion: SEED_VERSION,
    census: await census(graphName),
    nodesCreated,
    relationshipsCreated,
    expected: expectedCensus(),
  };
}

/** True when a complete seed of the current version is present. */
export async function isSeeded(graphName: string): Promise<boolean> {
  try {
    const r = await roQuery<{ seedVersion: string; complete: boolean }>(
      graphName,
      GET_SEED_MARKER,
    );
    const row = r.data[0];
    return row?.complete === true && row.seedVersion === SEED_VERSION;
  } catch {
    // A missing graph is a legitimate "not seeded", not an error.
    return false;
  }
}

/**
 * Re-seed path for a missing graph: the free tier reclaims idle instances, so
 * the demonstration must be able to rebuild itself from the domain pack.
 */
export async function ensureSeeded(graphName: string): Promise<{
  alreadySeeded: boolean;
  report: SeedReport | null;
}> {
  if (await isSeeded(graphName)) {
    return { alreadySeeded: true, report: null };
  }
  return { alreadySeeded: false, report: await seedEducationGraph(graphName) };
}
