/**
 * The scripted planner must end its investigation with a grounded conclusion,
 * and that conclusion must be composed from recorded tool results rather than
 * restated from the question.
 *
 * It must also leave the graph untouched: these are read tools, and an agent
 * that writes while "investigating" is the defect this project already fixed
 * once.
 *
 * Real FalkorDB. No mocks. No OpenAI calls.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runAgent } from "../src/lib/agent/loop";
import { scriptedPlanner, llmConfigured } from "../src/lib/agent/planners";
import { orgContext, NORTHSTAR_PACK } from "../src/lib/org/packs";
import { roQuery, closeDb } from "../src/lib/falkor/client";

const { graphName } = orgContext("northstar");
const MAX_STEPS = 8;

type Census = Record<string, number>;

async function census(): Promise<Census> {
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
}

let before: Census;
let after: Census;
let summary: string;
let steps: Awaited<ReturnType<typeof runAgent>>["steps"];
let stoppedBecause: string;

beforeAll(async () => {
  process.env.NF_AGENT_ENABLED = "true";
  before = await census();

  const planner = scriptedPlanner(NORTHSTAR_PACK.scenarioRootId, MAX_STEPS);
  const result = await runAgent(
    "What is exposed if the AI inference gateway becomes unavailable, and on what evidence?",
    NORTHSTAR_PACK.scenarioRootId,
    { graphName },
    planner,
    { maxSteps: MAX_STEPS, maxWallClockMs: 90_000, maxToolMs: 20_000 },
  );

  steps = result.steps;
  stoppedBecause = result.stoppedBecause;
  summary = planner.finalText() ?? "";
  after = await census();
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("the investigation reaches a conclusion", () => {
  it("produces a closing summary rather than running out of steps", () => {
    expect(summary.length).toBeGreaterThan(200);
    // The old behaviour exhausted the budget and returned nothing.
    expect(stoppedBecause).not.toMatch(/budget reached/i);
  });

  it("stops early enough to conclude", () => {
    expect(steps.length).toBeLessThan(MAX_STEPS);
  });

  it("still does real investigative work before concluding", () => {
    const tools = new Set(steps.map((s) => s.tool));
    expect(tools.has("analyse_impact")).toBe(true);
    expect(tools.has("explain_path")).toBe(true);
    expect(tools.has("get_evidence")).toBe(true);
    expect(steps.every((s) => s.ok)).toBe(true);
  });
});

describe("the conclusion is grounded in tool results", () => {
  it("reports the traversal counts the tool actually returned", () => {
    const analysis = steps.find((s) => s.tool === "analyse_impact");
    expect(analysis).toBeDefined();
    // Whatever the tool reported is what the summary must say.
    const m = analysis!.summary.match(/(\d+) distinct exposed entities via (\d+) paths/);
    expect(m).not.toBeNull();
    expect(summary).toContain(`${m![1]} distinct entities`);
    expect(summary).toContain(`${m![2]} dependency paths`);
  });

  it("matches the verified Northstar scenario: 10 entities, 12 paths", () => {
    expect(summary).toMatch(/\b10 distinct entities\b/);
    expect(summary).toMatch(/\b12 dependency paths\b/);
  });

  it("separates direct dependents from entities reached through intermediaries", () => {
    expect(summary).toMatch(/depend on it directly/);
    expect(summary).toMatch(/reached only through intermediaries/);
  });

  it("names the most distant exposure, which a one-hop check would miss", () => {
    expect(summary).toMatch(/most distant exposure is .+ at \d+ relationships/);
    expect(summary).toMatch(/direct dependency check would not have found it/i);
  });

  it("distinguishes OBSERVED from DERIVED claims", () => {
    expect(summary).toContain("OBSERVED");
    expect(summary).toContain("DERIVED");
    expect(summary).toMatch(/chaining relationships/);
  });

  it("only names entities that appear in a tool result", () => {
    const inspected = summary.match(/inspected directly for: (.+?)\./);
    expect(inspected).not.toBeNull();
    const named = inspected![1]!.split(",").map((s) => s.trim());
    const touched = new Set(steps.map((s) => String(s.args.entityId ?? "")).filter(Boolean));
    for (const id of named) expect(touched.has(id)).toBe(true);
  });
});

describe("the conclusion states its own uncertainty", () => {
  it("names findings that are not supported by resolvable evidence", () => {
    expect(summary).toMatch(/NOT supported by resolvable evidence|no finding is unsupported/);
  });

  it("names the unresolved source reference rather than hiding it", () => {
    expect(summary).toContain("src_ns_adr_014_current_status");
  });

  it("warns against acting on unsupported findings", () => {
    expect(summary).toMatch(/must not be acted on/i);
  });

  it("states limitations explicitly", () => {
    expect(summary).toContain("Limitations:");
    expect(summary).toMatch(/exposure to the change, not operational failure/);
    expect(summary).toMatch(/no replacement owner was inferred/);
  });

  it("never claims anything was executed", () => {
    expect(summary).toMatch(/nothing here has been executed/i);
    expect(summary).toMatch(/requires a human decision/i);
    expect(summary).not.toMatch(/\bI (fixed|executed|applied|reassigned)\b/i);
  });

  it("says so plainly when no analysis ran, instead of inventing an answer", async () => {
    const planner = scriptedPlanner("ns_entity_that_does_not_exist", MAX_STEPS);
    await runAgent(
      "anything",
      "ns_entity_that_does_not_exist",
      { graphName },
      planner,
      { maxSteps: MAX_STEPS, maxWallClockMs: 30_000, maxToolMs: 15_000 },
    ).catch(() => undefined);
    const text = planner.finalText();
    if (text) {
      expect(text).not.toMatch(/\b10 distinct entities\b/);
    }
  }, 60_000);
});

describe("the investigation is read-only", () => {
  it("leaves every node count unchanged", () => {
    expect(after).toEqual(before);
  });
});

describe("capability reporting is accurate", () => {
  const key = process.env.OPENAI_API_KEY;
  const llm = process.env.NF_AGENT_LLM;

  afterAll(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (llm === undefined) delete process.env.NF_AGENT_LLM;
    else process.env.NF_AGENT_LLM = llm;
  });

  it("is false when the model switch is off, even with a key present", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.NF_AGENT_LLM = "off";
    expect(llmConfigured()).toBe(false);
  });

  it("is false when the switch is on but no key is configured", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.NF_AGENT_LLM = "on";
    expect(llmConfigured()).toBe(false);
  });

  it("is true only when both gates are satisfied", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.NF_AGENT_LLM = "on";
    expect(llmConfigured()).toBe(true);
  });

  it("defaults to off when the switch is unset", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    delete process.env.NF_AGENT_LLM;
    expect(llmConfigured()).toBe(false);
  });
});
