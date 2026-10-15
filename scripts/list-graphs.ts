/** Read-only inventory of graphs on the instance. Mutates nothing. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { listGraphs, closeDb, connectionSummary } = await import("../src/lib/falkor/client");
const { GRAPH_PREFIX } = await import("../src/lib/env");

try {
  const graphs = await listGraphs();
  console.log(`${connectionSummary()}`);
  console.log(`\n${graphs.length} graph(s) on the instance:`);
  for (const g of graphs.sort()) {
    const owned = g.startsWith(GRAPH_PREFIX);
    console.log(`  ${owned ? "[nexusforge]" : "[OTHER — do not touch]"} ${g}`);
  }
  if (graphs.length === 0) console.log("  (none)");
} catch (err) {
  console.error(`LIST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
