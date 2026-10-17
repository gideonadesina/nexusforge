/**
 * Verify the scripted planner's closing summary. NO PAID CALLS.
 *
 * Checks that the investigation now ends with a grounded conclusion, that
 * every figure in it came from a tool result, and that the graph is unchanged.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { orgContext, NORTHSTAR_PACK } = await import("../src/lib/org/packs");
const { runAgent } = await import("../src/lib/agent/loop");
const { scriptedPlanner, llmConfigured } = await import("../src/lib/agent/planners");
const { callerKey, consumeVisitorQuota, RateLimitedError, visitorLimits } = await import(
  "../src/lib/agent/rate-limit"
);
const { roQuery, closeDb } = await import("../src/lib/falkor/client");

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails += 1;
};
const h = (s: string) => console.log(`\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`);

const { graphName } = orgContext("northstar");

try {
  process.env.NF_AGENT_ENABLED = "true";

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

  h("1. SCRIPTED INVESTIGATION WITH CLOSING SUMMARY");
  const before = await census();
  console.log(`before: ${JSON.stringify(before)}`);

  const MAX = 8;
  const planner = scriptedPlanner(NORTHSTAR_PACK.scenarioRootId, MAX);
  const t0 = Date.now();
  const result = await runAgent(
    "What is exposed if the AI inference gateway becomes unavailable, and on what evidence?",
    NORTHSTAR_PACK.scenarioRootId,
    { graphName },
    planner,
    { maxSteps: MAX, maxWallClockMs: 60_000, maxToolMs: 15_000 },
  );
  const elapsed = Date.now() - t0;

  for (const s of result.steps) {
    console.log(`${String(s.index).padStart(2)}. ${s.ok ? "ok " : "ERR"} ${s.tool.padEnd(15)} ${String(s.durationMs).padStart(5)}ms  ${s.summary.slice(0, 95)}`);
  }
  console.log(`\nsteps=${result.steps.length}  ${elapsed}ms  stopped: ${result.stoppedBecause}`);

  const final = planner.finalText();
  h("2. FINAL ANSWER");
  console.log(final ?? "(none)");

  h("3. ASSERTIONS");
  check("a closing summary was produced", typeof final === "string" && final.length > 200);
  const f = final ?? "";
  check("names the real exposed-entity count (10)", /\b10 distinct\b/.test(f));
  check("names the real path count (12)", /\b12 dependency paths\b/.test(f));
  check("separates direct from indirect exposure", /directly/.test(f) && /intermediaries/.test(f));
  check("distinguishes OBSERVED from DERIVED", /OBSERVED/.test(f) && /DERIVED/.test(f));
  check("states evidence uncertainty", /NOT supported|unsupported|Unresolved/i.test(f));
  check("states limitations explicitly", /Limitations:/.test(f));
  check("does not claim execution", /nothing here has been executed/i.test(f));
  check("stopped deliberately, not by exhaustion", !/budget reached/i.test(result.stoppedBecause));
  check("still used real tools", result.steps.length >= 5 && result.steps.every((s) => s.ok));

  const after = await census();
  console.log(`\nafter : ${JSON.stringify(after)}`);
  check("graph unchanged by the investigation", JSON.stringify(before) === JSON.stringify(after));

  h("4. PER-VISITOR RATE LIMIT");
  const lim = visitorLimits();
  console.log(`limit: ${lim.maxRequests} model requests / ${lim.windowMs / 60000} min`);
  const key = `test_${Date.now().toString(36)}`;
  let blockedAt = 0;
  for (let i = 1; i <= lim.maxRequests + 2; i += 1) {
    try {
      const r = await consumeVisitorQuota(key);
      console.log(`  call ${i}: allowed (${r.used}/${r.limit})`);
    } catch (e) {
      if (e instanceof RateLimitedError) {
        if (!blockedAt) blockedAt = i;
        console.log(`  call ${i}: BLOCKED, retry after ${e.retryAfterSeconds}s`);
      } else throw e;
    }
  }
  check("blocks exactly one past the limit", blockedAt === lim.maxRequests + 1, `blocked at ${blockedAt}`);
  check("key is a hash, never a raw address", !/\d+\.\d+\.\d+\.\d+/.test(callerKey(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9" } }))));

  h("5. CAPABILITY REPORTING");
  const key1 = process.env.OPENAI_API_KEY;
  const llm1 = process.env.NF_AGENT_LLM;
  process.env.NF_AGENT_LLM = "off";
  check("llmConfigured() false when the switch is off", llmConfigured() === false);
  process.env.NF_AGENT_LLM = "on";
  check("llmConfigured() true when key present and switch on", llmConfigured() === (typeof key1 === "string" && key1.length > 0));
  delete process.env.OPENAI_API_KEY;
  check("llmConfigured() false with no key even when switched on", llmConfigured() === false);
  if (key1) process.env.OPENAI_API_KEY = key1;
  if (llm1 === undefined) delete process.env.NF_AGENT_LLM;
  else process.env.NF_AGENT_LLM = llm1;
} catch (err) {
  fails += 1;
  console.error(`\nERROR: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await closeDb();
}

console.log(`\n${"=".repeat(70)}`);
console.log(fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
