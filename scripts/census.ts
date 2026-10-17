/** Read-only census of the demo graphs. No writes, no paid calls. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { orgContext } = await import("../src/lib/org/packs");
const { roQuery, listGraphs, closeDb } = await import("../src/lib/falkor/client");

const counts = async (graphName: string) => {
  const q = async (c: string) => (await roQuery<{ c: number }>(graphName, c)).data[0]?.c ?? 0;
  return {
    entities: await q(`MATCH (n:Entity) RETURN count(n) AS c`),
    sources: await q(`MATCH (n:Source) RETURN count(n) AS c`),
    deps: await q(`MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c`),
    runs: await q(`MATCH (n:AnalysisRun) RETURN count(n) AS c`),
    findings: await q(`MATCH (n:Finding) RETURN count(n) AS c`),
    proposals: await q(`MATCH (n:ActionProposal) RETURN count(n) AS c`),
    audits: await q(`MATCH (n:AuditEvent) RETURN count(n) AS c`),
  };
};

try {
  const graphs = await listGraphs();
  console.log(`graphs on instance (${graphs.length}): ${graphs.join(", ")}`);
  for (const org of ["northstar", "education"]) {
    const { graphName } = orgContext(org);
    console.log(`${org.padEnd(10)} ${graphName.padEnd(22)} ${JSON.stringify(await counts(graphName))}`);
  }
} finally {
  await closeDb();
}
