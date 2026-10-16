/**
 * Surgical removal of Education-origin records from the Northstar graph.
 *
 * Dry-run by default. Pass --execute to actually delete.
 *
 * Safety design:
 *  - Deletion targets an EXPLICIT ID LIST derived from the Education pack
 *    manifest, intersected with what is actually present. The `domain`
 *    property is NEVER the deletion criterion -- a mislabelled Northstar node
 *    must not be removable by accident.
 *  - Every precondition from the inventory is re-checked immediately before
 *    deleting. If anything has changed, it aborts without writing.
 *  - Nodes belonging to the Northstar manifest are explicitly excluded, so an
 *    id appearing in both manifests could never be deleted.
 *  - Runs, findings, proposals and audit events are never touched.
 */
import { loadLocalEnv } from "./_env";
import { writeFileSync } from "node:fs";

loadLocalEnv();

const { roQuery, writeQuery, closeDb } = await import("../src/lib/falkor/client");
const { orgContext, NORTHSTAR_PACK } = await import("../src/lib/org/packs");
const { EDUCATION_PACK, seedGraph } = await import("../src/lib/graph/seed");

const EXECUTE = process.argv.includes("--execute");
const { graphName } = orgContext("northstar");

const nsEntityIds = new Set(NORTHSTAR_PACK.entities.map((e) => e.id));
const nsSourceIds = new Set(NORTHSTAR_PACK.sources.map((s) => s.id));
const nsDepIds = new Set(NORTHSTAR_PACK.dependencies.map((d) => d.id));

/** Explicit delete lists: in the education manifest, NOT in the northstar one. */
const eduEntityIds = EDUCATION_PACK.entities.map((e) => e.id).filter((id) => !nsEntityIds.has(id));
const eduSourceIds = EDUCATION_PACK.sources.map((s) => s.id).filter((id) => !nsSourceIds.has(id));
const eduDepIds = EDUCATION_PACK.dependencies.map((d) => d.id).filter((id) => !nsDepIds.has(id));

function abort(reason: string): never {
  console.error(`\n*** ABORTED — ${reason}`);
  console.error("Nothing was deleted.");
  process.exit(1);
}

console.log("=".repeat(72));
console.log(`SURGICAL CLEANUP — ${graphName}   mode=${EXECUTE ? "EXECUTE" : "DRY RUN"}`);
console.log("=".repeat(72));

// ---- Re-check every precondition --------------------------------------
const present = await roQuery<{ id: string }>(
  graphName,
  `UNWIND $ids AS id MATCH (e:Entity {id: id}) RETURN e.id AS id`,
  { params: { ids: eduEntityIds } },
);
const presentSources = await roQuery<{ id: string }>(
  graphName,
  `UNWIND $ids AS id MATCH (s:Source {id: id}) RETURN s.id AS id`,
  { params: { ids: eduSourceIds } },
);
const nsPresent = await roQuery<{ c: number }>(
  graphName,
  `UNWIND $ids AS id MATCH (e:Entity {id: id}) RETURN count(e) AS c`,
  { params: { ids: [...nsEntityIds] } },
);

console.log(`education entities present : ${present.data.length} (expected 17)`);
console.log(`education sources present  : ${presentSources.data.length} (expected 7)`);
console.log(`northstar entities present : ${nsPresent.data[0]?.c ?? 0} (expected ${nsEntityIds.size})`);

if (present.data.length !== 17) abort(`expected 17 education entities, found ${present.data.length}`);
if (presentSources.data.length !== 7) abort(`expected 7 education sources, found ${presentSources.data.length}`);
if ((nsPresent.data[0]?.c ?? 0) !== nsEntityIds.size) abort("Northstar entity set is incomplete");

// No edge may join the two sets -- removal must be isolated.
const cross = await roQuery<{ c: number }>(
  graphName,
  `MATCH (a:Entity)-[:DEPENDS_ON]->(b:Entity)
   WHERE (a.id IN $edu AND b.id IN $ns) OR (a.id IN $ns AND b.id IN $edu)
   RETURN count(*) AS c`,
  { params: { edu: eduEntityIds, ns: [...nsEntityIds] } },
);
if ((cross.data[0]?.c ?? 0) !== 0) abort("edges join education and northstar entities");
console.log(`cross-set edges            : 0`);

// No finding or proposal may reference a delete candidate.
const refs = await roQuery<{ f: number; p: number }>(
  graphName,
  `OPTIONAL MATCH (f:Finding) WHERE f.entityId IN $edu
   WITH count(f) AS f
   OPTIONAL MATCH (p:ActionProposal) WHERE p.targetEntityId IN $edu
   RETURN f, count(p) AS p`,
  { params: { edu: eduEntityIds } },
);
if ((refs.data[0]?.f ?? 0) !== 0 || (refs.data[0]?.p ?? 0) !== 0) {
  abort(`findings/proposals reference education entities (${refs.data[0]?.f}/${refs.data[0]?.p})`);
}
console.log(`findings/proposals at risk : 0`);

// Capture run state so we can prove it survived.
const runsBefore = await roQuery<{ id: string }>(
  graphName,
  `MATCH (r:AnalysisRun) RETURN r.analysisRunId AS id ORDER BY id`,
);
const findingsBefore = await roQuery<{ c: number }>(graphName, `MATCH (f:Finding) RETURN count(f) AS c`);
const proposalsBefore = await roQuery<{ c: number }>(graphName, `MATCH (p:ActionProposal) RETURN count(p) AS c`);
const auditsBefore = await roQuery<{ c: number }>(graphName, `MATCH (a:AuditEvent) RETURN count(a) AS c`);
console.log(
  `preserving                 : ${runsBefore.data.length} runs, ${findingsBefore.data[0]?.c} findings, ` +
    `${proposalsBefore.data[0]?.c} proposals, ${auditsBefore.data[0]?.c} audit events`,
);

if (!EXECUTE) {
  console.log("\nDRY RUN — would delete:");
  console.log(`  ${present.data.length} Entity nodes (and their edges)`);
  console.log(`  ${presentSources.data.length} Source nodes (and their edges)`);
  console.log(`  ${eduDepIds.length} DEPENDS_ON ids are education-origin`);
  console.log("\nRe-run with --execute to apply.");
  await closeDb();
  process.exit(0);
}

// ---- Execute ----------------------------------------------------------
console.log("\nexecuting…");

// DETACH DELETE removes each node together with every edge attached to it,
// so EVIDENCED_BY / DEPENDS_ON belonging to these nodes go with them.
const delEntities = await writeQuery(
  graphName,
  `UNWIND $ids AS id MATCH (e:Entity {id: id}) DETACH DELETE e`,
  { params: { ids: eduEntityIds } },
);
console.log(`entities: ${JSON.stringify(delEntities.metadata)}`);

const delSources = await writeQuery(
  graphName,
  `UNWIND $ids AS id MATCH (s:Source {id: id}) DETACH DELETE s`,
  { params: { ids: eduSourceIds } },
);
console.log(`sources: ${JSON.stringify(delSources.metadata)}`);

// Restore the marker with the approved Northstar pack. MERGE-based, so this
// repairs the marker and any property drift without duplicating anything.
const report = await seedGraph(graphName, NORTHSTAR_PACK);
console.log(`\nre-seed census: ${JSON.stringify(report.census)}`);
console.log(`expected      : ${JSON.stringify(report.expected)}`);

// ---- Verify -----------------------------------------------------------
const after = {
  entities: (await roQuery<{ c: number }>(graphName, `MATCH (n:Entity) RETURN count(n) AS c`)).data[0]?.c,
  sources: (await roQuery<{ c: number }>(graphName, `MATCH (n:Source) RETURN count(n) AS c`)).data[0]?.c,
  deps: (await roQuery<{ c: number }>(graphName, `MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c`)).data[0]?.c,
  runs: (await roQuery<{ c: number }>(graphName, `MATCH (r:AnalysisRun) RETURN count(r) AS c`)).data[0]?.c,
  findings: (await roQuery<{ c: number }>(graphName, `MATCH (f:Finding) RETURN count(f) AS c`)).data[0]?.c,
  proposals: (await roQuery<{ c: number }>(graphName, `MATCH (p:ActionProposal) RETURN count(p) AS c`)).data[0]?.c,
  audits: (await roQuery<{ c: number }>(graphName, `MATCH (a:AuditEvent) RETURN count(a) AS c`)).data[0]?.c,
};
const marker = await roQuery<{ v: string; d: string }>(
  graphName,
  `MATCH (m:SeedMarker {id:'seed_marker'}) RETURN m.seedVersion AS v, m.domain AS d`,
);
const leftover = await roQuery<{ c: number }>(
  graphName,
  `MATCH (n) WHERE n.id IN $edu RETURN count(n) AS c`,
  { params: { edu: [...eduEntityIds, ...eduSourceIds] } },
);

console.log("\n--- POST-CLEANUP ---");
console.log(JSON.stringify(after, null, 1));
console.log(`seed marker : ${marker.data[0]?.d} / ${marker.data[0]?.v}`);
console.log(`education leftovers: ${leftover.data[0]?.c}`);

const runsAfter = await roQuery<{ id: string }>(
  graphName,
  `MATCH (r:AnalysisRun) RETURN r.analysisRunId AS id ORDER BY id`,
);
const runsIntact =
  runsAfter.data.length === runsBefore.data.length &&
  runsBefore.data.every((r) => runsAfter.data.some((x) => x.id === r.id));
console.log(`runs intact: ${runsIntact}`);

writeFileSync(
  "cleanup-result.json",
  JSON.stringify({ at: new Date().toISOString(), after, marker: marker.data[0], runsIntact }, null, 2),
  "utf8",
);

const ok =
  after.entities === NORTHSTAR_PACK.entities.length &&
  after.sources === NORTHSTAR_PACK.sources.length &&
  after.deps === NORTHSTAR_PACK.dependencies.length &&
  (leftover.data[0]?.c ?? -1) === 0 &&
  marker.data[0]?.v === "northstar-v1" &&
  runsIntact;

console.log(ok ? "\nCLEANUP VERIFIED" : "\n*** CLEANUP INCOMPLETE — inspect above ***");
await closeDb();
process.exitCode = ok ? 0 : 1;
