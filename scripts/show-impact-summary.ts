/** Print the exact analyse_impact summary a model planner receives. No paid calls. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { orgContext } = await import("../src/lib/org/packs");
const { getTool } = await import("../src/lib/agent/tools");
const { closeDb } = await import("../src/lib/falkor/client");

const { graphName } = orgContext("northstar");
const r = await getTool("analyse_impact")!.run(
  { rootEntityId: "ns_svc_inference_gateway", maxDepth: 8 },
  { graphName },
);
console.log(r.summary);
console.log(`\n[${r.summary.length} chars, ~${Math.ceil(r.summary.length / 4)} tokens]`);
await closeDb();
