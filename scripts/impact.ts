/**
 * Run the deterministic impact analysis against the seeded graph and print the
 * result. This is the Stage 1 "demo surface" -- CLI output, no UI.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { getEnv } = await import("../src/lib/env");
const { analyseImpact, recheckDistinctCount } = await import("../src/lib/engine/impact");
const { ensureSeeded } = await import("../src/lib/graph/seed");
const { closeDb } = await import("../src/lib/falkor/client");
const { SCENARIO_ROOT_ENTITY_ID } = await import("../src/domain/education/seed-data");

const graphName = getEnv().FALKORDB_GRAPH;
const rootId = process.argv[2] ?? SCENARIO_ROOT_ENTITY_ID;

try {
  const { alreadySeeded } = await ensureSeeded(graphName);
  console.log(alreadySeeded ? `graph ${graphName} already seeded` : `graph ${graphName} seeded now`);

  const analysis = await analyseImpact(graphName, rootId);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`CHANGED ENTITY: ${analysis.rootName}  [${analysis.rootEntityType}]`);
  console.log(`rule: ${analysis.ruleId}   depth bound: ${analysis.maxDepth}`);
  console.log("=".repeat(78));
  console.log(
    `\n${analysis.distinctImpactedCount} distinct exposed entities, ` +
      `reached by ${analysis.totalPathCount} dependency path(s).\n`,
  );

  for (const e of analysis.impacted) {
    console.log(`- ${e.name}`);
    console.log(`    id          : ${e.entityId}  [${e.entityType}]`);
    console.log(`    claim       : ${e.claim}  (${e.ruleId})`);
    console.log(
      `    shortest    : ${e.shortestPath.nodes.map((n) => n.id).join(" -> ")}` +
        `  (edgeHops=${e.shortestPath.edgeHops}, entityHops=${e.shortestPath.entityHops})`,
    );
    if (e.allPaths.length > 1) {
      console.log(`    routes      : ${e.allPaths.length} distinct paths`);
      e.allPaths.slice(1).forEach((p, i) => {
        console.log(
          `      alt ${i + 1}     : ${p.nodes.map((n) => n.id).join(" -> ")}` +
            `  (edgeHops=${p.edgeHops}, entityHops=${p.entityHops})`,
        );
      });
    }
    for (const ev of e.evidence) {
      console.log(`    evidence    : [${ev.sourceType}] ${ev.reference}`);
      console.log(`                  "${ev.excerpt.slice(0, 96)}${ev.excerpt.length > 96 ? "..." : ""}"`);
    }
    console.log("");
  }

  if (analysis.unevidencedEntityIds.length > 0) {
    console.log(`entities with an unevidenced edge: ${analysis.unevidencedEntityIds.join(", ")}`);
  }

  const recheck = await recheckDistinctCount(graphName, rootId, analysis.maxDepth);
  const agree = recheck === analysis.distinctImpactedCount;
  console.log(
    `independent re-check: ${recheck} distinct — ${agree ? "AGREES" : "DISAGREES"} with engine (${analysis.distinctImpactedCount})`,
  );
  if (!agree) process.exitCode = 1;

  console.log(
    "\nNote: a dependency path proves exposure to the change, not operational failure.",
  );
} catch (err) {
  console.error(`IMPACT FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
