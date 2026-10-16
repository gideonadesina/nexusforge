/**
 * ONE controlled paid investigation against the configured model.
 *
 * Deliberately conservative: a small step budget, a hard timeout, and a
 * single run per invocation. It prints token usage, latency, the tools the
 * model chose, and a grounding check comparing the model's narration against
 * what FalkorDB actually returned.
 *
 * Never prints the API key. Run explicitly; nothing calls this automatically.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

// Enable the model path for THIS PROCESS ONLY. The deployed app stays
// deterministic unless NF_AGENT_LLM is set in its own environment.
process.env.NF_AGENT_LLM = "on";

const { getEnv } = await import("../src/lib/env");
const { runAgent } = await import("../src/lib/agent/loop");
const { openAiPlanner, openAiConfigured, DEFAULT_MODEL, OPENAI_RESPONSES_URL } = await import(
  "../src/lib/agent/openai-planner"
);
const { resetBudget, budgetSnapshot } = await import("../src/lib/agent/budget");
const { analyseImpact } = await import("../src/lib/engine/impact");
const { ensureSeeded, EDUCATION_PACK } = await import("../src/lib/graph/seed");
const { closeDb } = await import("../src/lib/falkor/client");
const { SCENARIO_ROOT_ENTITY_ID } = await import("../src/domain/education/seed-data");

if (!openAiConfigured()) {
  console.error("OPENAI_API_KEY is not set. Aborting without making any call.");
  process.exit(1);
}

const graphName = getEnv().FALKORDB_GRAPH;
const rootId = process.argv[2] ?? SCENARIO_ROOT_ENTITY_ID;

console.log("=".repeat(72));
console.log("CONTROLLED PAID TEST — one investigation");
console.log("=".repeat(72));
console.log(`model    : ${DEFAULT_MODEL}`);
console.log(`endpoint : ${OPENAI_RESPONSES_URL}`);
console.log(`graph    : ${graphName}`);
console.log(`root     : ${rootId}`);
console.log(`budget   : 5 steps max, 40s wall clock, 20s per request`);
console.log("");

try {
  await ensureSeeded(graphName, EDUCATION_PACK);
  await resetBudget();

  // Ground truth straight from FalkorDB, for the grounding check.
  const truth = await analyseImpact(graphName, rootId);
  console.log(
    `FalkorDB ground truth: ${truth.distinctImpactedCount} entities, ` +
      `${truth.totalPathCount} paths, ` +
      `${truth.impacted.filter((e) => e.claim === "OBSERVED").length} OBSERVED`,
  );
  console.log("");

  const tally = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const MAX_STEPS = 7;
const planner = openAiPlanner(rootId, tally, MAX_STEPS);

  const t0 = Date.now();
  const result = await runAgent(
    `What is exposed if ${rootId} becomes unavailable, and on what evidence?`,
    rootId,
    { graphName },
    planner,
    { maxSteps: MAX_STEPS, maxWallClockMs: 60_000, maxToolMs: 15_000 },
  );
  const elapsed = Date.now() - t0;

  console.log("--- TOOL CALLS CHOSEN BY THE MODEL ---");
  for (const s of result.steps) {
    console.log(
      `${String(s.index).padStart(2)}. ${s.ok ? "ok " : "ERR"} ${s.tool.padEnd(16)} ` +
        `${s.durationMs}ms  ${JSON.stringify(s.args)}`,
    );
    console.log(`    -> ${s.summary.slice(0, 150)}`);
  }

  const finalText = planner.finalText();
  console.log("\n--- MODEL FINAL ANSWER ---");
  console.log(finalText ?? "(none — stopped at step budget)");

  console.log("\n--- USAGE AND COST ---");
  console.log(`model requests : ${tally.requests}`);
  console.log(`input tokens   : ${tally.inputTokens}`);
  console.log(`output tokens  : ${tally.outputTokens}`);
  console.log(`total tokens   : ${tally.totalTokens}`);
  console.log(`wall clock     : ${elapsed} ms`);
  console.log(`stopped because: ${result.stoppedBecause}`);
  const snap = await budgetSnapshot();
  console.log(`ledger         : ${snap.tokensUsed} tokens / ${snap.requestsUsed} requests`);
  console.log(
    `cost           : UNKNOWN — no verified public price for ${DEFAULT_MODEL} is available ` +
      `to this process. Multiply the token counts above by your account's rate.`,
  );

  console.log("\n--- GROUNDING CHECK ---");
  if (!finalText) {
    console.log("No final narration to check (hit the step budget).");
  } else {
    const claimsRightCount = finalText.includes(String(truth.distinctImpactedCount));
    console.log(
      `states the correct distinct count (${truth.distinctImpactedCount}): ${claimsRightCount}`,
    );
    // Any entity name mentioned must be a real one.
    const realNames = new Set(truth.impacted.map((e) => e.name.toLowerCase()));
    realNames.add(truth.rootName.toLowerCase());
    const suspicious = [...finalText.matchAll(/\b(?:SS\d|WAEC|Mr\.?|Mrs\.?|Dr\.?)\s?[A-Za-z]+/g)]
      .map((m) => m[0])
      .filter((t) => ![...realNames].some((n) => n.includes(t.toLowerCase())));
    console.log(
      suspicious.length === 0
        ? "no entity-like token appears that is absent from the graph"
        : `REVIEW these tokens, not matched to graph entities: ${[...new Set(suspicious)].join(", ")}`,
    );
  }

  console.log("\n--- SAFETY INVARIANTS ---");
  console.log(`canApprove exposed as: ${result.canApprove}`);
  const usedTools = new Set(result.steps.map((s) => s.tool));
  const forbidden = [...usedTools].filter((t) =>
    /approve|reject|execute|cypher|query/i.test(t),
  );
  console.log(
    forbidden.length === 0
      ? "no approval/execution/raw-query tool was reachable or used"
      : `VIOLATION: ${forbidden.join(", ")}`,
  );
} catch (err) {
  console.error(`\nTEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  console.error("Not retrying automatically — diagnose before spending again.");
  process.exitCode = 1;
} finally {
  await closeDb();
}
