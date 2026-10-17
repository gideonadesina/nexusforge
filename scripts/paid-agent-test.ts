/**
 * ONE authorized, hard-capped GPT-6 Luna investigation.
 *
 *   npx tsx scripts/paid-agent-test.ts --dry-run   measures payloads, spends nothing
 *   npx tsx scripts/paid-agent-test.ts --spend     issues the authorized paid run
 *
 * Authorized ceiling: 7 model requests, 6,000 combined tokens, no retries.
 *
 * Three independent enforcement layers, because one is not a guarantee:
 *   1. maxSteps caps planner turns, and the planner makes one request per turn.
 *   2. The FalkorDB budget ledger (NF_AGENT_MAX_REQUESTS / NF_AGENT_MAX_TOKENS)
 *      reserves before each call and throws when a cap is crossed.
 *   3. This harness wraps fetch: it refuses request 8 outright, and refuses any
 *      request whose projected completion would cross 6,000 tokens. Layer 3
 *      closes the gap in layer 2, where the ledger only learns the true cost
 *      after the call returns.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const DRY_RUN = !process.argv.includes("--spend");

const HARD_MAX_REQUESTS = 7;
const HARD_MAX_TOKENS = 6_000;
/** Refuse a call that could not complete inside the ceiling. */
const PROJECTED_CALL_COST = 2_200;

process.env.NF_AGENT_ENABLED = "true";
process.env.NF_AGENT_LLM = "on";
process.env.NF_AGENT_MAX_REQUESTS = String(HARD_MAX_REQUESTS);
process.env.NF_AGENT_MAX_TOKENS = String(HARD_MAX_TOKENS);
// Fresh window so prior usage cannot mask the caps under test.
process.env.NF_AGENT_WINDOW_MS = String(60 * 60 * 1000);

const { orgContext, NORTHSTAR_PACK } = await import("../src/lib/org/packs");
const { runAgent } = await import("../src/lib/agent/loop");
const { openAiPlanner, DEFAULT_MODEL, openAiConfigured } = await import(
  "../src/lib/agent/openai-planner"
);
const { resetBudget, budgetSnapshot, budgetLimits } = await import("../src/lib/agent/budget");
const { roQuery, closeDb } = await import("../src/lib/falkor/client");

const { graphName } = orgContext("northstar");
const h = (s: string) => console.log(`\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`);

/* ------------------------------------------------------------------ */
/* Layer 3: the fetch guard                                            */
/* ------------------------------------------------------------------ */

interface CallRecord {
  n: number;
  approxInputChars: number;
  approxInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  ms: number;
}

const calls: CallRecord[] = [];
let spentTokens = 0;
let refusedReason: string | null = null;

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("openai.com")) return realFetch(input as never, init);

  const n = calls.length + 1;
  const body = typeof init?.body === "string" ? init.body : "";
  const approxInputTokens = Math.ceil(body.length / 4);

  if (n > HARD_MAX_REQUESTS) {
    refusedReason = `guard refused request ${n}: over the ${HARD_MAX_REQUESTS}-request ceiling`;
    throw new Error(refusedReason);
  }
  if (spentTokens + PROJECTED_CALL_COST > HARD_MAX_TOKENS) {
    refusedReason =
      `guard refused request ${n}: ${spentTokens} tokens spent, a further call ` +
      `could cross the ${HARD_MAX_TOKENS}-token ceiling`;
    throw new Error(refusedReason);
  }

  if (DRY_RUN) {
    throw new Error(
      `DRY RUN: would have sent request ${n} (~${approxInputTokens} input tokens, ` +
        `${body.length} chars). Nothing was sent.`,
    );
  }

  const t0 = Date.now();
  const res = await realFetch(input as never, init);
  const ms = Date.now() - t0;

  // Read usage without consuming the body the planner needs.
  const clone = res.clone();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  try {
    const j = (await clone.json()) as {
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    inputTokens = j.usage?.input_tokens ?? 0;
    outputTokens = j.usage?.output_tokens ?? 0;
    totalTokens = j.usage?.total_tokens ?? inputTokens + outputTokens;
  } catch {
    /* non-JSON error body; usage stays zero */
  }

  spentTokens += totalTokens;
  calls.push({
    n,
    approxInputChars: body.length,
    approxInputTokens,
    inputTokens,
    outputTokens,
    totalTokens,
    ms,
  });
  console.log(
    `  [guard] request ${n}: in=${inputTokens} out=${outputTokens} total=${totalTokens} ` +
      `(cumulative ${spentTokens}/${HARD_MAX_TOKENS}) ${ms}ms`,
  );
  return res;
}) as typeof fetch;

/* ------------------------------------------------------------------ */

const census = async () => {
  const q = async (c: string) => (await roQuery<{ c: number }>(graphName, c)).data[0]?.c ?? 0;
  return {
    entities: await q(`MATCH (n:Entity) RETURN count(n) AS c`),
    sources: await q(`MATCH (n:Source) RETURN count(n) AS c`),
    deps: await q(`MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c`),
    runs: await q(`MATCH (n:AnalysisRun) RETURN count(n) AS c`),
    findings: await q(`MATCH (n:Finding) RETURN count(n) AS c`),
    proposals: await q(`MATCH (n:ActionProposal) RETURN count(n) AS c`),
  };
};

try {
  h(DRY_RUN ? "PRE-FLIGHT (DRY RUN, NOTHING SENT)" : "AUTHORIZED PAID RUN");
  console.log(`model            : ${DEFAULT_MODEL}`);
  console.log(`key present      : ${openAiConfigured()}`);
  console.log(`ceiling          : ${HARD_MAX_REQUESTS} requests / ${HARD_MAX_TOKENS} tokens`);
  console.log(`ledger limits    : ${JSON.stringify(budgetLimits())}`);
  console.log(`graph            : northstar (read-only tools)`);

  if (!openAiConfigured()) throw new Error("No OPENAI_API_KEY; refusing to continue.");

  const before = await census();
  console.log(`census before    : ${JSON.stringify(before)}`);

  if (!DRY_RUN) {
    await resetBudget();
    console.log(`ledger reset     : ${JSON.stringify(await budgetSnapshot())}`);
  }

  const question =
    "What is exposed if the AI inference gateway becomes unavailable, " +
    "which findings are not backed by resolvable evidence, and what should a human decide?";

  /**
   * Pre-flight measured the first request at ~1,015 input tokens, and the
   * transcript grows roughly 350 tokens per turn. Four turns would cross the
   * authorized 6,000-token ceiling, so the model is given three and told how
   * many remain: two for tools, the last to conclude. Being cut off mid-run
   * is the exact failure we just fixed in the scripted planner, so we budget
   * for the conclusion rather than hoping for it.
   */
  const MAX_STEPS = Number(process.argv.find((a) => a.startsWith("--steps="))?.slice(8) ?? 3);
  const tally = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const planner = openAiPlanner(NORTHSTAR_PACK.scenarioRootId, tally, MAX_STEPS);

  h("TRANSCRIPT");
  const t0 = Date.now();
  let result = null;
  let runError: string | null = null;
  try {
    result = await runAgent(
      question,
      NORTHSTAR_PACK.scenarioRootId,
      { graphName },
      planner,
      { maxSteps: MAX_STEPS, maxWallClockMs: 120_000, maxToolMs: 15_000 },
    );
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
  }
  const elapsed = Date.now() - t0;

  if (result) {
    for (const s of result.steps) {
      console.log(`\n${String(s.index).padStart(2)}. ${s.ok ? "ok " : "ERR"} ${s.tool}  (${s.durationMs}ms)`);
      console.log(`    model's reason: ${s.rationale}`);
      console.log(`    args: ${JSON.stringify(s.args)}`);
      console.log(`    result: ${s.summary.slice(0, 260)}`);
    }
    console.log(`\nmode=${result.mode}`);
    console.log(`planner=${result.plannerLabel}`);
    console.log(`steps=${result.steps.length}  ${elapsed}ms  stopped: ${result.stoppedBecause}`);
  }
  if (runError) console.log(`\nrun ended with: ${runError}`);
  if (refusedReason) console.log(`guard: ${refusedReason}`);

  h("MODEL'S FINAL ANSWER");
  console.log(planner.finalText() ?? "(none produced)");

  h("USAGE AND COST");
  console.table(calls);
  const totalIn = calls.reduce((a, c) => a + c.inputTokens, 0);
  const totalOut = calls.reduce((a, c) => a + c.outputTokens, 0);
  console.log(`requests       : ${calls.length} / ${HARD_MAX_REQUESTS}`);
  console.log(`input tokens   : ${totalIn}`);
  console.log(`output tokens  : ${totalOut}`);
  console.log(`total tokens   : ${totalIn + totalOut} / ${HARD_MAX_TOKENS}`);
  console.log(`planner tally  : ${JSON.stringify(tally)}`);
  console.log(`ledger after   : ${JSON.stringify(await budgetSnapshot())}`);

  const after = await census();
  console.log(`\ncensus after   : ${JSON.stringify(after)}`);
  console.log(
    JSON.stringify(before) === JSON.stringify(after)
      ? "PASS  graph unchanged by the paid investigation"
      : "FAIL  GRAPH CHANGED",
  );
} catch (err) {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await closeDb();
}
