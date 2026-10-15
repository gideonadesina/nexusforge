/**
 * Delete leftover nf_test_* / nf_probe_* graphs.
 *
 * Test runs that die mid-way (the DNS fault documented in docs/LOG.md) skip
 * their afterAll cleanup and leave graphs behind, which matters on a 100 MB
 * free tier.
 *
 * Safety: only deletes names matching the test/probe prefixes. The demo graph
 * and anything else on the instance are listed and left alone. Pass --dry to
 * preview.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { listGraphs, dropGraph, closeDb } = await import("../src/lib/falkor/client");
const { getEnv } = await import("../src/lib/env");

const DRY = process.argv.includes("--dry");
const DISPOSABLE = /^nf_(test|probe)_/;

try {
  const demoGraph = getEnv().FALKORDB_GRAPH;
  const graphs = await listGraphs();

  const disposable = graphs.filter((g) => DISPOSABLE.test(g) && g !== demoGraph);
  const kept = graphs.filter((g) => !disposable.includes(g));

  console.log(`${graphs.length} graph(s) on the instance\n`);
  for (const g of kept) console.log(`  KEEP   ${g}`);
  for (const g of disposable) console.log(`  ${DRY ? "WOULD DELETE" : "DELETE"} ${g}`);

  if (disposable.length === 0) {
    console.log("\nnothing to clean up");
  } else if (!DRY) {
    for (const g of disposable) await dropGraph(g);
    const after = await listGraphs();
    console.log(`\ndeleted ${disposable.length}; ${after.length} graph(s) remain`);
    const survived = kept.every((g) => after.includes(g));
    console.log(survived ? "all kept graphs intact" : "WARNING: a kept graph is missing");
    if (!survived) process.exitCode = 1;
  }
} catch (err) {
  console.error(`CLEANUP FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
