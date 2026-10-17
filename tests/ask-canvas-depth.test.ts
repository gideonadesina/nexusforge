/**
 * Ask drives the canvas at a depth something was actually computed under.
 *
 * When Ask answers a question, the central canvas loads the matching
 * investigation. The bound it draws has to come from what really ran -- the
 * grounded answer's traversal, or the agent's validated tool arguments --
 * because the sidebar prints its depth bound in prose right next to the
 * graph. A canvas drawn at any other depth contradicts the answer beside it.
 *
 * Pure logic: no graph, no model, no network.
 */
import { describe, it, expect } from "vitest";
import { answeredDepth, type AgentRun, type AgentStep } from "../src/components/agent-transcript";
import { DEFAULT_DEPTH } from "../src/lib/engine/impact";
import { DEFAULT_TRAVERSAL_DEPTH, MAX_TRAVERSAL_DEPTH } from "../src/lib/graph/depth";

function step(partial: Partial<AgentStep>): AgentStep {
  return {
    index: 0,
    tool: "analyse_impact",
    args: {},
    rationale: "test",
    summary: "test",
    durationMs: 1,
    ok: true,
    ...partial,
  };
}

function run(steps: AgentStep[]): AgentRun {
  return {
    mode: "llm",
    plannerLabel: "test planner",
    steps,
    stoppedBecause: "done",
  };
}

describe("answeredDepth", () => {
  it("draws at the depth the engine actually defaults to", () => {
    // The canvas helper runs in the browser bundle, so it reads the default
    // from lib/graph/depth: importing lib/engine/impact there would pull the
    // FalkorDB driver into the client and fail the build. That makes two
    // declarations of the same number, so pin them equal here -- if they
    // ever drift, the canvas would draw a bound the engine never used.
    expect(DEFAULT_TRAVERSAL_DEPTH).toBe(DEFAULT_DEPTH);
  });

  it("uses the grounded answer's bound when no model ran", () => {
    // composeAnswer always traverses at DEFAULT_DEPTH and says so in prose,
    // so a deterministic answer pins the canvas there.
    expect(answeredDepth(null)).toBe(DEFAULT_DEPTH);
    expect(answeredDepth(undefined)).toBe(DEFAULT_DEPTH);
  });

  it("uses the grounded bound when the model ran no traversal", () => {
    const agent = run([step({ tool: "list_entities", args: { minDependents: 1 } })]);
    expect(answeredDepth(agent)).toBe(DEFAULT_DEPTH);
  });

  it("reads the depth the model actually traversed when it went deeper", () => {
    const agent = run([step({ args: { rootEntityId: "e1", maxDepth: 8 } })]);
    expect(answeredDepth(agent)).toBe(8);
  });

  it("does not narrow the canvas below the grounded answer's bound", () => {
    // The grounded answer at DEFAULT_DEPTH is still on screen and is the
    // authoritative text, so a shallower model traversal cannot hide the
    // entities that answer cites.
    const agent = run([step({ args: { rootEntityId: "e1", maxDepth: 2 } })]);
    expect(answeredDepth(agent)).toBe(DEFAULT_DEPTH);
  });

  it("treats an omitted maxDepth as the engine default it really ran at", () => {
    // analyse_impact makes maxDepth optional; analyseImpact then applies
    // DEFAULT_DEPTH, so this is a known traversal, not an unknown one.
    const agent = run([step({ args: { rootEntityId: "e1" } })]);
    expect(answeredDepth(agent)).toBe(DEFAULT_DEPTH);
  });

  it("ignores a failed traversal", () => {
    const agent = run([step({ args: { rootEntityId: "e1", maxDepth: 8 }, ok: false })]);
    expect(answeredDepth(agent)).toBe(DEFAULT_DEPTH);
  });

  it("never reports a depth the engine would refuse", () => {
    // Values outside the engine's range cannot be a bound any traversal
    // completed under, so they are ignored rather than drawn.
    for (const bad of [0, -1, 99, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "6", null]) {
      const agent = run([step({ args: { rootEntityId: "e1", maxDepth: bad } })]);
      const depth = answeredDepth(agent);
      expect(depth).toBeGreaterThanOrEqual(1);
      expect(depth).toBeLessThanOrEqual(MAX_TRAVERSAL_DEPTH);
      expect(Number.isInteger(depth)).toBe(true);
    }
  });

  it("always returns a depth /api/analysis will accept", () => {
    const cases: (AgentRun | null)[] = [
      null,
      run([]),
      run([step({ args: { rootEntityId: "e1", maxDepth: 1 } })]),
      run([step({ args: { rootEntityId: "e1", maxDepth: MAX_TRAVERSAL_DEPTH } })]),
    ];
    for (const agent of cases) {
      const depth = answeredDepth(agent);
      expect(Number.isInteger(depth)).toBe(true);
      expect(depth).toBeGreaterThanOrEqual(1);
      expect(depth).toBeLessThanOrEqual(MAX_TRAVERSAL_DEPTH);
    }
  });

  it("reads only the analyse_impact step, not another tool's arguments", () => {
    // explain_path also takes a maxDepth. Picking the wrong step would draw
    // a bound belonging to a different call.
    const agent = run([
      step({ index: 0, tool: "explain_path", args: { rootEntityId: "e1", maxDepth: 2 } }),
      step({ index: 1, tool: "analyse_impact", args: { rootEntityId: "e1", maxDepth: 7 } }),
    ]);
    expect(answeredDepth(agent)).toBe(7);
  });
});
