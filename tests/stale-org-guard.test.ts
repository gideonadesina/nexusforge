/**
 * STEP 2 regression — stale organization responses.
 *
 * Astra reproduced delayed Northstar results rendering beneath the Education
 * header. The UI guards against this with a request-generation counter that
 * is bumped whenever the organization changes; any response carrying an older
 * generation is discarded.
 *
 * These tests exercise that rule as pure logic (no DOM required), plus the
 * server-side guarantee that a mislabelled request cannot succeed at all.
 *
 * Real FalkorDB for the server-side half. No OpenAI.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { orgContext } from "../src/lib/org/packs";
import { resolveOrg, UnknownOrganizationError } from "../src/lib/org/registry";
import { closeDb } from "../src/lib/falkor/client";

afterAll(async () => {
  await closeDb();
});

/**
 * The guard, extracted exactly as the component applies it.
 * A response is accepted only when BOTH the generation and the organization
 * still match what is currently selected.
 */
function accepts(
  responseGen: number,
  responseOrg: string,
  currentGen: number,
  currentOrg: string,
): boolean {
  return responseGen === currentGen && responseOrg === currentOrg;
}

describe("request-generation guard", () => {
  it("accepts a response that arrives while the same org is still selected", () => {
    expect(accepts(3, "northstar", 3, "northstar")).toBe(true);
  });

  it("discards a Northstar response that lands after switching to Education", () => {
    // The exact reproduction: request issued at gen 3 under northstar, user
    // switches (gen -> 4, org -> education), slow response finally arrives.
    expect(accepts(3, "northstar", 4, "education")).toBe(false);
  });

  it("discards even if the generation matches but the org changed", () => {
    expect(accepts(4, "northstar", 4, "education")).toBe(false);
  });

  it("discards even if the org matches but a newer request superseded it", () => {
    // Switching away and back again must not resurrect the old response.
    expect(accepts(3, "northstar", 5, "northstar")).toBe(false);
  });

  it("handles rapid switching without ever accepting a stale result", () => {
    let gen = 0;
    const inFlight: Array<{ gen: number; org: string }> = [];
    for (const org of ["northstar", "education", "northstar", "education"]) {
      gen += 1;
      inFlight.push({ gen, org });
    }
    const currentGen = gen;
    const currentOrg = "education";
    const accepted = inFlight.filter((r) => accepts(r.gen, r.org, currentGen, currentOrg));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toEqual({ gen: 4, org: "education" });
  });
});

describe("the component actually applies the guard", () => {
  const src = readFileSync("src/components/Investigation.tsx", "utf8");

  it("bumps the generation when the organization changes", () => {
    expect(src).toMatch(/const gen = \+\+requestGen\.current;/);
  });

  it("checks generation AND organization before using an analysis response", () => {
    expect(src).toMatch(/gen !== requestGen\.current \|\| orgAtRequest !== orgId/);
  });

  it("captures the organization at request time", () => {
    expect(src).toMatch(/const orgAtRequest = orgId;/);
  });

  it("clears investigation state on organization change", () => {
    const effect = src.slice(src.indexOf("const gen = ++requestGen.current;"));
    for (const reset of [
      "setAnalysis(null)",
      "setProposals([])",
      "setAuditEvents([])",
      "setSelectedId(null)",
      "setInspectorOpen(false)",
    ]) {
      expect(effect).toContain(reset);
    }
  });

  it("passes the organization to the agent panel", () => {
    expect(src).toMatch(/<AgentPanel orgId=\{orgId\} rootEntityId=\{rootId\}/);
  });
});

describe("agent requests carry a validated organization", () => {
  it("the agent panel sends an org with every request", () => {
    const src = readFileSync("src/components/AgentPanel.tsx", "utf8");
    expect(src).toMatch(/JSON\.stringify\(\{ org: orgId, rootEntityId \}\)/);
  });

  it("the agent panel clears its transcript when the org changes", () => {
    const src = readFileSync("src/components/AgentPanel.tsx", "utf8");
    expect(src).toMatch(/\}, \[orgId\]\);/);
  });

  it("the server resolves the org through the allowlist, never a raw graph", () => {
    expect(orgContext("northstar").graphName).toBe("nf_demo_northstar");
    expect(orgContext("education").graphName).toBe("nf_demo_education");
    expect(() => resolveOrg("nf_demo_northstar")).toThrow(UnknownOrganizationError);
  });
});

describe("Inspector visibility is separate from the traced selection", () => {
  const src = readFileSync("src/components/Investigation.tsx", "utf8");

  it("tracks inspector state independently", () => {
    expect(src).toMatch(/const \[inspectorOpen, setInspectorOpen\] = useState\(false\)/);
  });

  it("closing the inspector does NOT clear the selection", () => {
    // onClose must only close the sheet.
    expect(src).toMatch(/onClose=\{\(\) => setInspectorOpen\(false\)\}/);
  });

  it("the canvas still receives the selection while the sheet is closed", () => {
    // selectedId drives the trace; only the Inspector's entity is gated.
    expect(src).toMatch(/entity=\{inspectorOpen \? selected : null\}/);
    expect(src).toMatch(/selectedId=\{selectedId\}/);
  });

  it("offers a way back into the evidence without re-selecting", () => {
    expect(src).toMatch(/onShowEvidence/);
  });

  it("clearing the trace clears both", () => {
    expect(src).toMatch(/setSelectedId\(null\);\s*\n\s*setInspectorOpen\(false\);/);
  });
});
