/** Seed (or re-seed) the synthetic education graph. Idempotent. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { getEnv } = await import("../src/lib/env");
const { seedEducationGraph } = await import("../src/lib/graph/seed");
const { closeDb, connectionSummary } = await import("../src/lib/falkor/client");

const graphName = getEnv().FALKORDB_GRAPH;

try {
  console.log(`seeding ${graphName} on ${connectionSummary()}`);
  const report = await seedEducationGraph(graphName);

  console.log(`\nseedVersion: ${report.seedVersion}`);
  console.log(`created this run: ${report.nodesCreated} node(s), ${report.relationshipsCreated} relationship(s)`);
  console.log("\ncensus (read back from the database):");
  console.table({ actual: report.census, expected: report.expected });

  const mismatches = (Object.keys(report.expected) as Array<keyof typeof report.expected>).filter(
    (k) => report.census[k] !== report.expected[k],
  );
  if (mismatches.length > 0) {
    console.error(`\nCENSUS MISMATCH on: ${mismatches.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nseed OK — census matches the domain pack exactly");
  }
} catch (err) {
  console.error(`SEED FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
