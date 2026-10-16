/**
 * READ-ONLY cleanup inventory for the contaminated Northstar graph.
 *
 * Identifies exactly which records are Education-origin, using explicit
 * manifest membership rather than the `domain` property alone. A node is a
 * deletion candidate ONLY if its id appears in the Education pack manifest
 * AND does not appear in the Northstar pack manifest.
 *
 * Any ambiguity -- an id present in both manifests, or a node in neither --
 * is reported as a BLOCKER and nothing is proposed for deletion.
 *
 * Writes a JSON snapshot of every affected record so the removal is
 * recoverable. Uses roQuery only: it physically cannot modify the graph.
 *
 * Usage: npx tsx scripts/cleanup-inventory.ts [outputPath]
 */
import { loadLocalEnv } from "./_env";
import { writeFileSync } from "node:fs";

loadLocalEnv();

const { roQuery, closeDb } = await import("../src/lib/falkor/client");
const { orgContext, NORTHSTAR_PACK } = await import("../src/lib/org/packs");
const { EDUCATION_PACK } = await import("../src/lib/graph/seed");

const { graphName } = orgContext("northstar");
const outPath = process.argv[2] ?? "cleanup-snapshot.json";

const nsEntityIds = new Set(NORTHSTAR_PACK.entities.map((e) => e.id));
const nsSourceIds = new Set(NORTHSTAR_PACK.sources.map((s) => s.id));
const nsDepIds = new Set(NORTHSTAR_PACK.dependencies.map((d) => d.id));

const eduEntityIds = new Set(EDUCATION_PACK.entities.map((e) => e.id));
const eduSourceIds = new Set(EDUCATION_PACK.sources.map((s) => s.id));
const eduDepIds = new Set(EDUCATION_PACK.dependencies.map((d) => d.id));

const blockers: string[] = [];

function classify(id: string, ns: Set<string>, edu: Set<string>): string {
  const inNs = ns.has(id);
  const inEdu = edu.has(id);
  if (inNs && inEdu) return "AMBIGUOUS_BOTH";
  if (inNs) return "KEEP_NORTHSTAR";
  if (inEdu) return "DELETE_EDUCATION";
  return "UNKNOWN_NEITHER";
}

console.log("=".repeat(72));
console.log(`CLEANUP INVENTORY (read-only)  —  ${graphName}`);
console.log("=".repeat(72));

// ---- manifest collision check (safeguard 4) --------------------------
const entityCollisions = [...eduEntityIds].filter((id) => nsEntityIds.has(id));
const sourceCollisions = [...eduSourceIds].filter((id) => nsSourceIds.has(id));
const depCollisions = [...eduDepIds].filter((id) => nsDepIds.has(id));
console.log(
  `manifest collisions: entities=${entityCollisions.length}, ` +
    `sources=${sourceCollisions.length}, deps=${depCollisions.length}`,
);
if (entityCollisions.length || sourceCollisions.length || depCollisions.length) {
  blockers.push("Manifests share ids; deletion by manifest membership is unsafe.");
}

// ---- entities --------------------------------------------------------
const entities = await roQuery<{ id: string; name: string; domain: string; type: string }>(
  graphName,
  `MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.domain AS domain, e.type AS type ORDER BY id`,
);
const entityBuckets: Record<string, typeof entities.data> = {
  KEEP_NORTHSTAR: [],
  DELETE_EDUCATION: [],
  AMBIGUOUS_BOTH: [],
  UNKNOWN_NEITHER: [],
};
for (const e of entities.data) {
  entityBuckets[classify(e.id, nsEntityIds, eduEntityIds)]!.push(e);
}
console.log(`\nentities total: ${entities.data.length}`);
for (const [k, v] of Object.entries(entityBuckets)) console.log(`  ${k}: ${v.length}`);
for (const e of entityBuckets.DELETE_EDUCATION!) {
  console.log(`    DELETE  ${e.id}  [domain=${e.domain}]  ${e.name}`);
}
for (const e of entityBuckets.UNKNOWN_NEITHER!) {
  console.log(`    UNKNOWN ${e.id}  [domain=${e.domain}]  ${e.name}`);
}

// ---- sources ---------------------------------------------------------
const sources = await roQuery<{ id: string; sourceType: string; reference: string }>(
  graphName,
  `MATCH (s:Source) RETURN s.id AS id, s.sourceType AS sourceType, s.reference AS reference ORDER BY id`,
);
const sourceBuckets: Record<string, typeof sources.data> = {
  KEEP_NORTHSTAR: [],
  DELETE_EDUCATION: [],
  AMBIGUOUS_BOTH: [],
  UNKNOWN_NEITHER: [],
};
for (const s of sources.data) {
  sourceBuckets[classify(s.id, nsSourceIds, eduSourceIds)]!.push(s);
}
console.log(`\nsources total: ${sources.data.length}`);
for (const [k, v] of Object.entries(sourceBuckets)) console.log(`  ${k}: ${v.length}`);
for (const s of sourceBuckets.DELETE_EDUCATION!) {
  console.log(`    DELETE  ${s.id}  [${s.sourceType}]`);
}
for (const s of sourceBuckets.UNKNOWN_NEITHER!) {
  console.log(`    UNKNOWN ${s.id}  [${s.sourceType}]`);
}

// ---- dependency edges ------------------------------------------------
const deps = await roQuery<{ id: string; from: string; to: string }>(
  graphName,
  `MATCH (a:Entity)-[r:DEPENDS_ON]->(b:Entity)
   RETURN r.id AS id, a.id AS from, b.id AS to ORDER BY id`,
);
const depDelete = deps.data.filter((d) => classify(d.id, nsDepIds, eduDepIds) === "DELETE_EDUCATION");
const depUnknown = deps.data.filter((d) => classify(d.id, nsDepIds, eduDepIds) === "UNKNOWN_NEITHER");
console.log(`\nDEPENDS_ON total: ${deps.data.length}  delete=${depDelete.length}  unknown=${depUnknown.length}`);

// ---- cross-contamination edges: any edge joining the two sets? -------
const deleteEntityIds = new Set(entityBuckets.DELETE_EDUCATION!.map((e) => e.id));
const crossEdges = deps.data.filter(
  (d) =>
    (deleteEntityIds.has(d.from) && nsEntityIds.has(d.to)) ||
    (nsEntityIds.has(d.from) && deleteEntityIds.has(d.to)),
);
console.log(`edges joining education and northstar entities: ${crossEdges.length}`);
if (crossEdges.length) {
  for (const e of crossEdges) console.log(`    CROSS ${e.id}: ${e.from} -> ${e.to}`);
  blockers.push("Education and Northstar entities are joined by edges; removal is not isolated.");
}

// ---- runs, findings, proposals, audit (must be preserved) ------------
const runs = await roQuery<{ id: string; root: string; status: string }>(
  graphName,
  `MATCH (r:AnalysisRun) RETURN r.analysisRunId AS id, r.rootEntityId AS root, r.status AS status ORDER BY id`,
);
const findings = await roQuery<{ id: string; entityId: string; runId: string }>(
  graphName,
  `MATCH (f:Finding) RETURN f.findingId AS id, f.entityId AS entityId, f.analysisRunId AS runId ORDER BY id`,
);
const proposals = await roQuery<{ id: string; target: string; state: string }>(
  graphName,
  `MATCH (p:ActionProposal) RETURN p.proposalId AS id, p.targetEntityId AS target, p.state AS state ORDER BY id`,
);
const audits = await roQuery<{ id: string }>(
  graphName,
  `MATCH (a:AuditEvent) RETURN a.auditEventId AS id ORDER BY id`,
);

console.log(
  `\nruns=${runs.data.length} findings=${findings.data.length} ` +
    `proposals=${proposals.data.length} auditEvents=${audits.data.length}`,
);
for (const r of runs.data) {
  const ok = nsEntityIds.has(r.root);
  console.log(`  run ${r.id}  root=${r.root} ${ok ? "(northstar)" : "(*** NOT NORTHSTAR ***)"}`);
  if (!ok) blockers.push(`Run ${r.id} is rooted at a non-Northstar entity.`);
}

// Would any finding/proposal reference an entity we plan to delete?
const findingsAtRisk = findings.data.filter((f) => deleteEntityIds.has(f.entityId));
const proposalsAtRisk = proposals.data.filter((p) => deleteEntityIds.has(p.target));
console.log(`findings referencing a delete-candidate: ${findingsAtRisk.length}`);
console.log(`proposals referencing a delete-candidate: ${proposalsAtRisk.length}`);
if (findingsAtRisk.length || proposalsAtRisk.length) {
  blockers.push("Existing findings/proposals reference education entities; deletion would orphan them.");
}

// ---- seed marker -----------------------------------------------------
const marker = await roQuery<{ v: string; d: string }>(
  graphName,
  `MATCH (m:SeedMarker {id:'seed_marker'}) RETURN m.seedVersion AS v, m.domain AS d`,
);
console.log(`\nseed marker: ${marker.data[0]?.d} / ${marker.data[0]?.v} (expected technology-operations / northstar-v1)`);

// ---- expected-count check (safeguard 4) ------------------------------
const expectDeleteEntities = 17;
const expectDeleteSources = 7;
const okCounts =
  entityBuckets.DELETE_EDUCATION!.length === expectDeleteEntities &&
  sourceBuckets.DELETE_EDUCATION!.length === expectDeleteSources &&
  entityBuckets.AMBIGUOUS_BOTH!.length === 0 &&
  sourceBuckets.AMBIGUOUS_BOTH!.length === 0 &&
  entityBuckets.UNKNOWN_NEITHER!.length === 0 &&
  sourceBuckets.UNKNOWN_NEITHER!.length === 0 &&
  entityBuckets.KEEP_NORTHSTAR!.length === NORTHSTAR_PACK.entities.length &&
  sourceBuckets.KEEP_NORTHSTAR!.length === NORTHSTAR_PACK.sources.length;

console.log(
  `\nexpected: delete ${expectDeleteEntities} entities / ${expectDeleteSources} sources, ` +
    `keep ${NORTHSTAR_PACK.entities.length} / ${NORTHSTAR_PACK.sources.length}`,
);
if (!okCounts) blockers.push("Counts do not match the expected inventory exactly.");

// ---- snapshot (safeguard 7) ------------------------------------------
const snapshot = {
  capturedAt: new Date().toISOString(),
  graphName,
  deleteEntities: entityBuckets.DELETE_EDUCATION,
  deleteSources: sourceBuckets.DELETE_EDUCATION,
  deleteDependencies: depDelete,
  keepEntities: entityBuckets.KEEP_NORTHSTAR!.map((e) => e.id),
  keepSources: sourceBuckets.KEEP_NORTHSTAR!.map((s) => s.id),
  runs: runs.data,
  findings: findings.data,
  proposals: proposals.data,
  auditEvents: audits.data,
  seedMarker: marker.data[0] ?? null,
};
writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`\nsnapshot written: ${outPath}`);

console.log("\n" + "=".repeat(72));
if (blockers.length === 0) {
  console.log("INVENTORY CLEAN — surgical deletion is unambiguous and safe to propose.");
} else {
  console.log("*** BLOCKERS — DO NOT DELETE ***");
  for (const b of blockers) console.log(`  - ${b}`);
}
console.log("=".repeat(72));
console.log("(read-only: nothing was modified)");

await closeDb();
process.exitCode = blockers.length === 0 ? 0 : 1;
