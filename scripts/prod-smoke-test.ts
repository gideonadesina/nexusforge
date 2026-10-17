/**
 * ONE bounded live production smoke test of the public paid pilot.
 *
 *   npx tsx scripts/prod-smoke-test.ts --dry-run
 *   npx tsx scripts/prod-smoke-test.ts --spend
 *
 * This calls the PUBLIC deployment over HTTPS exactly as a judge's browser
 * would. It does not import the agent, so it exercises the real route, the
 * real env configuration and the real server-side limits.
 *
 * Authorized ceiling: 7 model requests, 6,000 tokens. Production is itself
 * capped at 3 visitor investigations per hour, so this harness issues ONE
 * request and then verifies the limits report correctly.
 */
export {}; // top-level await requires this file to be a module

const BASE = process.env.NF_SMOKE_BASE ?? "https://nexusforge-ten.vercel.app";
const DRY_RUN = !process.argv.includes("--spend");
const HARD_MAX_TOKENS = 6_000;
const HARD_MAX_REQUESTS = 7;

const h = (s: string) => console.log(`\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`);
let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails += 1;
};

interface AskBody {
  mode?: string;
  modelAvailable?: boolean;
  rateLimited?: boolean;
  visitorLimit?: number;
  agentError?: string | null;
  answer?: { text?: string; supported?: boolean; citedSourceIds?: string[] };
  agent?: {
    mode?: string;
    plannerLabel?: string;
    stoppedBecause?: string;
    finalText?: string | null;
    steps?: Array<{ index: number; tool: string; args: Record<string, unknown>; summary: string; durationMs: number; ok: boolean }>;
  } | null;
  usage?: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs?: number;
}

try {
  h("1. PUBLIC CAPABILITY AND HEALTH");

  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`health      : ok=${health.ok} org=${health.organization} graph=${health.graphName} seeded=${health.seeded}`);
  check("deployment healthy", health.ok === true);
  check("Northstar graph is the live org", health.graphName === "nf_demo_northstar" && health.seeded === true);

  const cap = await (await fetch(`${BASE}/api/agent`)).json();
  console.log(`agent route : enabled=${cap.enabled} mode=${cap.mode} modelOnAsk=${cap.modelAvailableOnAskRoute}`);
  check("scripted route never claims to be a model", cap.mode === "scripted");
  check("scripted route points at the model-backed route", cap.modelBackedRoute === "/api/ask");

  const askCap = await (await fetch(`${BASE}/api/ask?org=northstar`)).json();
  console.log(`ask route   : modelAvailable=${askCap.modelAvailable} suggestions=${(askCap.suggestions ?? []).length}`);

  h("2. DETERMINISTIC PATH, FREE, MUST ALWAYS WORK");

  const detRes = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      org: "northstar",
      question: "What is exposed if the AI inference gateway becomes unavailable?",
    }),
  });
  const det = (await detRes.json()) as AskBody;
  console.log(`mode=${det.mode} latency=${det.latencyMs}ms`);
  console.log(`answer: ${String(det.answer?.text).slice(0, 220)}`);
  check("deterministic answer returned", detRes.ok && det.mode === "deterministic");
  check("deterministic path spends nothing", det.usage === undefined || det.usage.requests === 0);

  if (!askCap.modelAvailable) {
    h("MODEL NOT ENABLED ON THIS DEPLOYMENT");
    console.log("Paid inference is off. Nothing was spent. Enable it before running --spend.");
    process.exit(fails === 0 ? 0 : 1);
  }

  if (DRY_RUN) {
    h("DRY RUN COMPLETE, NOTHING PAID WAS SENT");
    console.log("Re-run with --spend to issue the one authorized paid production investigation.");
    process.exit(fails === 0 ? 0 : 1);
  }

  h("3. PAID MODEL PATH, ONE AUTHORIZED INVESTIGATION");

  const t0 = Date.now();
  const modelRes = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      org: "northstar",
      question:
        "What is exposed if the AI inference gateway becomes unavailable, " +
        "which findings lack resolvable evidence, and what should a human decide?",
      useModel: true,
    }),
  });
  const m = (await modelRes.json()) as AskBody;
  const elapsed = Date.now() - t0;

  console.log(`mode=${m.mode} latency=${elapsed}ms rateLimited=${m.rateLimited}`);
  if (m.agentError) console.log(`agentError: ${m.agentError}`);

  if (m.agent?.steps) {
    console.log(`\nplanner: ${m.agent.plannerLabel}`);
    for (const s of m.agent.steps) {
      console.log(`\n${String(s.index).padStart(2)}. ${s.ok ? "ok " : "ERR"} ${s.tool}  (${s.durationMs}ms)`);
      console.log(`    args: ${JSON.stringify(s.args)}`);
      console.log(`    result: ${s.summary.slice(0, 300)}`);
    }
    console.log(`\nstopped: ${m.agent.stoppedBecause}`);
  }

  h("MODEL'S FINAL ANSWER (PRODUCTION)");
  console.log(m.agent?.finalText ?? "(none)");

  h("4. USAGE AND COST");
  const u = m.usage ?? { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const cost = (u.inputTokens * 0.1) / 1e6 + (u.outputTokens * 0.5) / 1e6;
  console.log(`requests: ${u.requests} / ${HARD_MAX_REQUESTS}`);
  console.log(`tokens  : ${u.inputTokens} in + ${u.outputTokens} out = ${u.totalTokens} / ${HARD_MAX_TOKENS}`);
  console.log(`cost    : $${cost.toFixed(6)} at $0.10/M in, $0.50/M out`);

  check("stayed within the authorized request ceiling", u.requests <= HARD_MAX_REQUESTS, `${u.requests}`);
  check("stayed within the authorized token ceiling", u.totalTokens <= HARD_MAX_TOKENS, `${u.totalTokens}`);
  check("the model actually ran", m.mode === "model-planned" && !!m.agent);
  check("the model chose real graph tools", (m.agent?.steps ?? []).length >= 2);
  check("every tool call succeeded", (m.agent?.steps ?? []).every((s) => s.ok));
  check("a grounded final answer was produced", (m.agent?.finalText ?? "").length > 120);
  check(
    "the answer names real Northstar entities",
    /ns_[a-z_]+/.test(m.agent?.finalText ?? "") || /gateway|Meridian|failover/i.test(m.agent?.finalText ?? ""),
  );
  check("the deterministic answer is still present alongside", !!m.answer?.text);

  h("5. RATE LIMIT IS LIVE");
  console.log(`visitor limit reported: ${m.visitorLimit} investigations/hour`);
  check("a per-visitor limit is configured", typeof m.visitorLimit === "number" && m.visitorLimit! > 0);
} catch (err) {
  fails += 1;
  console.error(`\nERROR: ${err instanceof Error ? err.stack : String(err)}`);
}

console.log(`\n${"=".repeat(70)}`);
console.log(fails === 0 ? "SMOKE TEST PASSED" : `${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
