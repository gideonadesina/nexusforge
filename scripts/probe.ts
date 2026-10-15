/**
 * Stage 1 feasibility probe against the REAL FalkorDB instance.
 *
 * Proves, in order:
 *   1. connection
 *   2. read-only graph listing (no mutation of anything pre-existing)
 *   3. creation of an isolated, uniquely named nf_probe_* graph
 *   4. a bounded two-hop dependency traversal
 *   5. read-back of the expected relationships and path
 *   6. GRAPH.RO_QUERY rejecting a write, with a post-check proving no mutation
 *   7. cleanup of ONLY the probe graph this run created
 *
 * Prints no credential values. Exits non-zero on any failure.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { getDb, roQuery, writeQuery, listGraphs, dropGraph, connectionSummary, closeDb } =
  await import("../src/lib/falkor/client");

function heading(s: string): void {
  console.log(`\n=== ${s} ===`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Unique per run so concurrent runs can never collide. */
const probeGraph = `nf_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let created = false;
let preExisting: string[] = [];

try {
  heading("1. connect");
  await getDb();
  console.log(`connected to ${connectionSummary()}`);
  check("connection established", true);

  heading("2. list graphs (READ-ONLY)");
  preExisting = await listGraphs();
  console.log(`existing graphs (${preExisting.length}):`);
  for (const g of preExisting) console.log(`  - ${g}`);
  check("graph listing succeeded", true, `${preExisting.length} graph(s)`);
  check(
    `probe name "${probeGraph}" does not collide`,
    !preExisting.includes(probeGraph),
  );

  heading("3. create isolated probe graph with a 2-hop dependency chain");
  // CLASS -> DEPENDS_ON -> ASSIGNMENT -> DEPENDS_ON -> TEACHER
  // (dependent -> dependency, matching architecture rule 2.4)
  const createRes = await writeQuery(
    probeGraph,
    `
CREATE (c:Entity {id: 'probe_class',   type: 'Class',      name: 'Probe Class'}),
       (a:Entity {id: 'probe_assign',  type: 'Assignment', name: 'Probe Assignment'}),
       (t:Entity {id: 'probe_teacher', type: 'Person',     name: 'Probe Teacher'}),
       (d:Entity {id: 'probe_decoy',   type: 'Class',      name: 'Probe Decoy Class'}),
       (c)-[:DEPENDS_ON {id: 'probe_dep_1', sourceId: 'probe_src_1'}]->(a),
       (a)-[:DEPENDS_ON {id: 'probe_dep_2', sourceId: 'probe_src_2'}]->(t)
RETURN 1 AS ok
`.trim(),
  );
  created = true;
  console.log(`metadata: ${JSON.stringify(createRes.metadata)}`);
  check("probe graph created", true);

  const nowListed = await listGraphs();
  check("probe graph appears in listing", nowListed.includes(probeGraph));

  heading("4+5. bounded two-hop traversal and path read-back (RO_QUERY)");
  const traversal = await roQuery<{
    entityId: string;
    pathIds: string[];
    pathKinds: unknown[];
    edgeHops: number;
  }>(
    probeGraph,
    `
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..2]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
RETURN affected.id                          AS entityId,
       [n IN nodes(p) | n.id]               AS pathIds,
       [r IN relationships(p) | r.sourceId] AS pathKinds,
       length(p)                            AS edgeHops
ORDER BY edgeHops, entityId
`.trim(),
    { params: { rootId: "probe_teacher" } },
  );

  for (const row of traversal.data) {
    console.log(
      `  ${row.entityId}  edgeHops=${row.edgeHops}  path=${JSON.stringify(row.pathIds)}  sources=${JSON.stringify(row.pathKinds)}`,
    );
  }

  const ids = traversal.data.map((r) => r.entityId).sort();
  check(
    "traversal found exactly the 2 dependents",
    JSON.stringify(ids) === JSON.stringify(["probe_assign", "probe_class"]),
    `got ${JSON.stringify(ids)}`,
  );

  const twoHop = traversal.data.find((r) => r.entityId === "probe_class");
  check(
    "2-hop path is class -> assignment -> teacher",
    JSON.stringify(twoHop?.pathIds) ===
      JSON.stringify(["probe_class", "probe_assign", "probe_teacher"]),
    `got ${JSON.stringify(twoHop?.pathIds)}`,
  );
  check("2-hop row reports edgeHops=2", twoHop?.edgeHops === 2, `got ${String(twoHop?.edgeHops)}`);
  check(
    "parameterized query worked (decoy excluded)",
    !ids.includes("probe_decoy"),
  );

  heading("6. read-only enforcement (E7): RO_QUERY must reject a write");
  const beforeRes = await roQuery<{ c: number }>(
    probeGraph,
    `MATCH (n:Entity) RETURN count(n) AS c`,
  );
  const before = beforeRes.data[0]?.c ?? -1;
  console.log(`node count before: ${before}`);

  let rejected = false;
  let rejectionMessage = "";
  try {
    await roQuery(
      probeGraph,
      `CREATE (:Entity {id: 'probe_illegal_write', type: 'Illegal', name: 'should not exist'}) RETURN 1 AS ok`,
    );
  } catch (err) {
    rejected = true;
    rejectionMessage = err instanceof Error ? err.message : String(err);
  }
  check("RO_QUERY rejected the write", rejected, rejectionMessage || "no error raised");

  const afterRes = await roQuery<{ c: number }>(
    probeGraph,
    `MATCH (n:Entity) RETURN count(n) AS c`,
  );
  const after = afterRes.data[0]?.c ?? -1;
  console.log(`node count after:  ${after}`);
  check("node count unchanged", before === after, `${before} -> ${after}`);

  const leaked = await roQuery<{ c: number }>(
    probeGraph,
    `MATCH (n:Entity {id: 'probe_illegal_write'}) RETURN count(n) AS c`,
  );
  check("illegal node absent from graph", (leaked.data[0]?.c ?? -1) === 0);

  heading("7. ownership guard");
  let guarded = false;
  try {
    await writeQuery("some_other_peoples_graph", `CREATE (:X) RETURN 1`);
  } catch (err) {
    guarded = /may only touch graphs/.test(err instanceof Error ? err.message : "");
  }
  check("non-nf_ graph write refused by ownership guard", guarded);
} catch (err) {
  failures += 1;
  console.error(`\nPROBE ERROR: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  heading("8. cleanup (probe graph only)");
  if (created) {
    try {
      await dropGraph(probeGraph);
      const remaining = await listGraphs();
      check(`probe graph "${probeGraph}" deleted`, !remaining.includes(probeGraph));
      const survived = preExisting.every((g) => remaining.includes(g));
      check(
        "all pre-existing graphs still present",
        survived,
        `before=${preExisting.length} after=${remaining.length}`,
      );
    } catch (err) {
      failures += 1;
      console.error(`CLEANUP FAILED for ${probeGraph}: ${String(err)}`);
    }
  } else {
    console.log("nothing to clean up (probe graph was never created)");
  }
  await closeDb();
}

console.log(`\n${failures === 0 ? "PROBE PASSED" : `PROBE FAILED (${failures} check(s))`}`);
process.exit(failures === 0 ? 0 : 1);
