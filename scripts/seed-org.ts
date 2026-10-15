/**
 * Seed one organization's graph. Idempotent.
 *
 * Usage: npx tsx scripts/seed-org.ts [northstar|education]
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { orgContext } = await import("../src/lib/org/packs");
const { seedGraph } = await import("../src/lib/graph/seed");
const { analyseImpact } = await import("../src/lib/engine/impact");
const { closeDb } = await import("../src/lib/falkor/client");

const orgId = process.argv[2] ?? "northstar";

try {
  const { org, pack, graphName } = orgContext(orgId);
  console.log(`organization : ${org.label} (${org.sector})`);
  console.log(`graph        : ${graphName}`);
  console.log(`pack         : ${pack.domain} ${pack.seedVersion}`);

  const report = await seedGraph(graphName, pack);
  console.log(`\ncreated this run: ${report.nodesCreated} nodes, ${report.relationshipsCreated} rels`);
  console.table({ actual: report.census, expected: report.expected });

  const mismatches = (Object.keys(report.expected) as Array<keyof typeof report.expected>).filter(
    (k) => report.census[k] !== report.expected[k],
  );
  if (mismatches.length) {
    console.error(`CENSUS MISMATCH: ${mismatches.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("census matches the pack exactly");
  }

  const analysis = await analyseImpact(graphName, pack.scenarioRootId);
  console.log(
    `\nscenario: ${analysis.distinctImpactedCount} distinct entities via ${analysis.totalPathCount} paths`,
  );
  for (const e of analysis.impacted) {
    console.log(
      `  ${String(e.shortestPath.edgeHops)}e/${e.shortestPath.entityHops}n ` +
        `${e.claim.padEnd(8)} ${e.evidenceStatus.padEnd(8)} ${e.entityId}`,
    );
  }
  const decoysFound = pack.decoyEntityIds.filter((d) =>
    analysis.impacted.some((e) => e.entityId === d),
  );
  console.log(
    decoysFound.length === 0
      ? "\ndecoys correctly excluded"
      : `\nDECOY LEAK: ${decoysFound.join(", ")}`,
  );
  if (decoysFound.length) process.exitCode = 1;
} catch (err) {
  console.error(`SEED FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
