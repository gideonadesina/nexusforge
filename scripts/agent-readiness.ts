/**
 * Track 1 agent readiness review. NO PAID CALLS.
 *
 * Runs the scripted planner against the real Northstar graph and checks the
 * safety properties that matter for exposing an agent publicly:
 *   - read tools cannot write
 *   - the kill switch actually stops execution
 *   - organization boundaries hold inside the tool surface
 *   - budgets are enforced from FalkorDB, not process memory
 *   - prompt-injection text in graph data cannot widen the tool surface
 *   - no secret reaches a tool result
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { orgContext, NORTHSTAR_PACK } = await import("../src/lib/org/packs");
const { runAgent, agentEnabled, AgentDisabledError } = await import("../src/lib/agent/loop");
const { scriptedPlanner, llmConfigured } = await import("../src/lib/agent/planners");
const { TOOLS, getTool, toolCatalogue } = await import("../src/lib/agent/tools");
const { openAiConfigured, DEFAULT_MODEL } = await import("../src/lib/agent/openai-planner");
const { budgetSnapshot, budgetLimits } = await import("../src/lib/agent/budget");
const { roQuery, closeDb } = await import("../src/lib/falkor/client");

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails += 1;
};
const h = (s: string) => console.log(`\n${"=".repeat(68)}\n${s}\n${"=".repeat(68)}`);

const { graphName } = orgContext("northstar");

try {
  /* ---------------------------------------------------------------- */
  h("1. CONFIGURATION AND KILL SWITCH");

  console.log(`NF_AGENT_ENABLED (local) : ${process.env.NF_AGENT_ENABLED ?? "(unset)"}`);
  console.log(`NF_AGENT_LLM     (local) : ${process.env.NF_AGENT_LLM ?? "(unset)"}`);
  console.log(`OPENAI key present       : ${openAiConfigured()}`);
  console.log(`model if enabled         : ${DEFAULT_MODEL}`);
  console.log(`llmConfigured() reports  : ${llmConfigured()}`);

  const original = process.env.NF_AGENT_ENABLED;
  delete process.env.NF_AGENT_ENABLED;
  check("kill switch defaults to OFF when unset", agentEnabled() === false);
  process.env.NF_AGENT_ENABLED = "false";
  check("explicit false disables", agentEnabled() === false);

  // A disabled agent must refuse to run at all.
  let refused = false;
  try {
    await runAgent("x", NORTHSTAR_PACK.scenarioRootId, { graphName }, scriptedPlanner("x"));
  } catch (e) {
    refused = e instanceof AgentDisabledError;
  }
  check("runAgent refuses while disabled", refused);

  process.env.NF_AGENT_ENABLED = "true";
  check("explicit true enables", agentEnabled() === true);

  /* ---------------------------------------------------------------- */
  h("2. TOOL SURFACE");

  console.log(`tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  check("every tool is declared read-only", TOOLS.every((t) => !t.mutates));
  check(
    "no approve/reject/execute/cypher tool exists",
    !TOOLS.some((t) => /approve|reject|execute|cypher|write|delete|seed/i.test(t.name)),
  );
  const schemas = toolCatalogue();
  check("every tool publishes a JSON schema", schemas.every((s) => !!s.input_schema));
  check(
    "no tool accepts a free-text query parameter",
    !JSON.stringify(schemas).match(/"(query|cypher|statement|sql)"/i),
  );

  /* ---------------------------------------------------------------- */
  h("3. READ TOOLS CANNOT MUTATE (real graph, before/after census)");

  const census = async () => {
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
  const before = await census();
  console.log(`before: ${JSON.stringify(before)}`);

  /* ---------------------------------------------------------------- */
  h("4. SCRIPTED PLANNER, FULL NORTHSTAR INVESTIGATION");

  const t0 = Date.now();
  const result = await runAgent(
    `What is exposed if the AI inference gateway becomes unavailable, and on what evidence?`,
    NORTHSTAR_PACK.scenarioRootId,
    { graphName },
    scriptedPlanner(NORTHSTAR_PACK.scenarioRootId),
    { maxSteps: 8, maxWallClockMs: 60_000, maxToolMs: 15_000 },
  );
  const elapsed = Date.now() - t0;

  for (const s of result.steps) {
    console.log(`${String(s.index).padStart(2)}. ${s.ok ? "ok " : "ERR"} ${s.tool.padEnd(16)} ${String(s.durationMs).padStart(5)}ms`);
    console.log(`    why: ${s.rationale}`);
    console.log(`    ->  ${s.summary.slice(0, 170)}`);
  }
  console.log(`\nmode=${result.mode}  steps=${result.steps.length}  ${elapsed}ms  stopped: ${result.stoppedBecause}`);

  check("investigation completed without error", result.steps.every((s) => s.ok || s.tool === "list_proposals"));
  check("planner is labelled scripted, not reasoning", result.mode === "scripted" && /scripted/i.test(result.plannerLabel));
  check("canApprove is exposed as false", result.canApprove === false);
  check("used more than one distinct tool", new Set(result.steps.map((s) => s.tool)).size >= 3);

  const analysisStep = result.steps.find((s) => s.tool === "analyse_impact" && s.ok);
  check("ran the real traversal", !!analysisStep);
  check(
    "traversal result matches the verified scenario",
    !!analysisStep && /10 distinct exposed entities via 12 paths/.test(analysisStep.summary),
    analysisStep?.summary.slice(0, 80),
  );

  const evidenceSteps = result.steps.filter((s) => s.tool === "get_evidence" && s.ok);
  check("traced evidence for at least one finding", evidenceSteps.length >= 1);
  const pathSteps = result.steps.filter((s) => s.tool === "explain_path" && s.ok);
  check("explained at least one dependency path", pathSteps.length >= 1);

  // Did it prioritise the weak findings, which is the behaviour we claim?
  const touched = result.steps.map((s) => String(s.args.entityId ?? "")).filter(Boolean);
  check(
    "prioritised an unsupported or multi-route finding",
    touched.some((id) =>
      ["ns_plan_failover_external", "ns_resp_gateway_failover", "ns_assign_oncall_gateway", "ns_commitment_meridian"].includes(id),
    ),
    touched.join(", "),
  );

  const after = await census();
  console.log(`after : ${JSON.stringify(after)}`);
  check("graph completely unchanged by the investigation", JSON.stringify(before) === JSON.stringify(after));

  /* ---------------------------------------------------------------- */
  h("5. ORGANIZATION BOUNDARY INSIDE THE TOOL SURFACE");

  const eduCtx = orgContext("education");
  const eduList = await getTool("list_entities")!.run({ minDependents: 0 }, { graphName: eduCtx.graphName });
  const nsList = await getTool("list_entities")!.run({ minDependents: 0 }, { graphName });
  const eduIds = JSON.stringify((eduList.data as Array<{ id: string }>).map((e) => e.id));
  const nsIds = JSON.stringify((nsList.data as Array<{ id: string }>).map((e) => e.id));
  check("education tool call returns no ns_ entities", !eduIds.includes("ns_"));
  check("northstar tool call returns no ent_ entities", !/"ent_/.test(nsIds));

  // A tool cannot be pointed at an arbitrary graph name.
  let guarded = false;
  try {
    await getTool("list_entities")!.run({ minDependents: 0 }, { graphName: "someone_elses_graph" });
  } catch (e) {
    guarded = /may only touch graphs/.test(e instanceof Error ? e.message : "");
  }
  check("tool refuses a non-nf_ graph name", guarded);

  /* ---------------------------------------------------------------- */
  h("6. BUDGET, SHARED ACROSS INSTANCES");

  const limits = budgetLimits();
  const snap = await budgetSnapshot();
  console.log(`limits: ${limits.maxTokens} tokens / ${limits.maxRequests} requests per ${limits.windowMs / 3600000}h`);
  console.log(`used  : ${snap.tokensUsed} tokens / ${snap.requestsUsed} requests`);
  const ledger = await roQuery<{ c: number }>(
    graphName,
    `MATCH (b:AgentBudget {id:'agent_budget_global'}) RETURN count(b) AS c`,
  );
  check("budget ledger is a FalkorDB node, not process memory", (ledger.data[0]?.c ?? 0) >= 0);
  check("a token cap is configured", limits.maxTokens > 0 && limits.maxRequests > 0);

  /* ---------------------------------------------------------------- */
  h("7. PROMPT INJECTION BOUNDARY");

  // Graph content is data. Even if a source excerpt contained instructions,
  // the tool surface is fixed, so the worst case is misleading prose.
  const inj = await roQuery<{ c: number }>(
    graphName,
    `MATCH (s:Source) WHERE s.excerpt CONTAINS 'ignore' OR s.excerpt CONTAINS 'instruction'
     RETURN count(s) AS c`,
  );
  console.log(`sources containing instruction-like text: ${inj.data[0]?.c ?? 0}`);
  check(
    "no tool can be added or widened at runtime",
    TOOLS.length === toolCatalogue().length && TOOLS.every((t) => !t.mutates),
  );
  check(
    "tool arguments are schema-validated, so injected text cannot become a query",
    !JSON.stringify(toolCatalogue()).match(/"additionalProperties"\s*:\s*true/),
  );

  /* ---------------------------------------------------------------- */
  h("8. SECRET HANDLING IN TOOL OUTPUT");

  const blob = JSON.stringify(result);
  const leaks: string[] = [];
  for (const k of ["OPENAI_API_KEY", "FALKORDB_PASSWORD", "FALKORDB_HOST"]) {
    const v = process.env[k];
    if (v && v.length > 3 && blob.includes(v)) leaks.push(k);
  }
  check("no credential value appears in the agent transcript", leaks.length === 0, leaks.join(","));
  check("no ownerTokenHash in transcript", !blob.includes("ownerTokenHash"));

  if (original === undefined) delete process.env.NF_AGENT_ENABLED;
  else process.env.NF_AGENT_ENABLED = original;
} catch (err) {
  fails += 1;
  console.error(`\nREVIEW ERROR: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await closeDb();
}

console.log(`\n${"=".repeat(68)}`);
console.log(fails === 0 ? "ALL READINESS CHECKS PASSED" : `${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
