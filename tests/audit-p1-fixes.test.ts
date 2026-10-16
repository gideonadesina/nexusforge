/**
 * Astra audit P1 regressions — FIX 2 (unsupported claims) and FIX 3
 * (suggested questions), verified against the Northstar fixture.
 *
 * Real FalkorDB. No OpenAI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedGraph } from "../src/lib/graph/seed";
import { NORTHSTAR_PACK } from "../src/lib/org/packs";
import { analyseImpact } from "../src/lib/engine/impact";
import { generateProposals } from "../src/lib/actions/rules";
import { buildSections } from "../src/components/Findings";
import {
  readGraphFacts,
  verifiedSuggestions,
  suggestQuestions,
  resolveQuestion,
} from "../src/lib/agent/questions";
import { composeAnswer } from "../src/lib/agent/answer";
import { publicView, resolveOrg } from "../src/lib/org/registry";
import { closeDb } from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { ImpactAnalysis } from "../src/lib/engine/types";
import type { GraphFacts } from "../src/lib/agent/questions";

const graphName = uniqueTestGraph("auditp1");
const NS_ORG = publicView(resolveOrg("northstar"));
let analysis: ImpactAnalysis;
let facts: GraphFacts;

beforeAll(async () => {
  await seedGraph(graphName, NORTHSTAR_PACK);
  analysis = await analyseImpact(graphName, NORTHSTAR_PACK.scenarioRootId);
  facts = await readGraphFacts(graphName, NORTHSTAR_PACK);
}, 240_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

/* ------------------------------------------------------------------ */
/* FIX 2 — unsupported claims                                          */
/* ------------------------------------------------------------------ */

describe("FIX 2 — routes are 'distinct', never claimed 'independent'", () => {
  it("the multi-route section does not assert independence or substitution", () => {
    const section = buildSections(analysis.impacted).find((s) => s.key === "constrained")!;
    expect(section.rule).not.toMatch(/independent/i);
    expect(section.rule).not.toMatch(/substitution/i);
    expect(section.rule).toMatch(/distinct/i);
    expect(section.title).not.toMatch(/independent/i);
  });

  it("the Meridian routes genuinely share intermediate entities", () => {
    // This is WHY the independence claim was wrong: the two routes overlap.
    const meridian = analysis.impacted.find((e) => e.entityId === "ns_commitment_meridian")!;
    expect(meridian.allPaths.length).toBeGreaterThan(1);

    const nodeSets = meridian.allPaths.map((p) => new Set(p.nodes.map((n) => n.id)));
    const shared = [...nodeSets[0]!].filter((id) => nodeSets.every((s) => s.has(id)));
    // They share more than just the endpoints.
    expect(shared.length).toBeGreaterThan(2);
    expect(shared).toContain("ns_obligation_soc2_evidence");
  });

  it("the narrated answer says routes are not necessarily independent", async () => {
    const resolved = resolveQuestion(
      "why is the Meridian Health MSA affected?",
      facts,
      NORTHSTAR_PACK.scenarioRootId,
    );
    const answer = await composeAnswer(graphName, resolved, NS_ORG);
    expect(answer.text).not.toMatch(/independent routes/i);
    expect(answer.text).not.toMatch(/single substitution/i);
    if (/distinct routes/i.test(answer.text)) {
      expect(answer.text).toMatch(/not necessarily independent/i);
    }
  }, 60_000);
});

describe("FIX 2 — no operational proposal on unsupported findings", () => {
  it("the unsupported failover plan gets NO reassignment proposal", () => {
    const drafts = generateProposals(analysis);
    const plan = drafts.filter((d) => d.targetEntityId === "ns_plan_failover_external");

    expect(plan.length).toBeGreaterThan(0); // it is still surfaced
    for (const d of plan) {
      expect(d.actionType).not.toBe("REASSIGN_DEPENDENCY");
      expect(d.ruleId).toBe("rule.action.resolve-evidence-gap@1");
    }
  });

  it("keeps the evidence-gap proposal for it", () => {
    const drafts = generateProposals(analysis);
    const gap = drafts.find(
      (d) =>
        d.targetEntityId === "ns_plan_failover_external" &&
        d.actionType === "RESOLVE_EVIDENCE_GAP",
    );
    expect(gap).toBeDefined();
    expect(gap!.supported).toBe(false);
  });

  it("no reassignment proposal targets any unsupported finding", () => {
    const unsupported = new Set(
      analysis.impacted.filter((e) => !e.supported).map((e) => e.entityId),
    );
    expect(unsupported.size).toBeGreaterThan(0);

    for (const d of generateProposals(analysis)) {
      if (d.actionType === "REASSIGN_DEPENDENCY") {
        expect(unsupported.has(d.targetEntityId)).toBe(false);
        expect(d.supported).toBe(true);
      }
    }
  });

  it("still proposes reassignment for well-evidenced direct dependencies", () => {
    const reassigns = generateProposals(analysis).filter(
      (d) => d.actionType === "REASSIGN_DEPENDENCY",
    );
    expect(reassigns.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* FIX 3 — suggested questions                                         */
/* ------------------------------------------------------------------ */

describe("FIX 3 — only verified suggestions are offered", () => {
  it("every offered suggestion round-trips to its advertised intent", () => {
    const offered = verifiedSuggestions(facts, NORTHSTAR_PACK.scenarioRootId);
    expect(offered.length).toBeGreaterThan(0);

    for (const s of offered) {
      const r = resolveQuestion(s.text, facts, NORTHSTAR_PACK.scenarioRootId);
      expect(r.intent, `"${s.text}" must resolve to ${s.intent}`).toBe(s.intent);
      if (s.entityId) {
        const subject = r.targetEntityId ?? r.rootEntityId;
        expect(subject === s.entityId || r.entityIds.includes(s.entityId)).toBe(true);
      }
    }
  });

  it("hides any suggestion that misroutes", () => {
    const all = suggestQuestions(facts);
    const offered = verifiedSuggestions(facts, NORTHSTAR_PACK.scenarioRootId);
    // Offered must be a subset; hiding is the safety mechanism.
    for (const s of offered) expect(all.some((a) => a.id === s.id)).toBe(true);
    expect(offered.length).toBeLessThanOrEqual(all.length);
  });

  it("the scope answer names the LOADED organization, not the school", async () => {
    const r = resolveQuestion("what organization is loaded?", facts, null);
    expect(r.intent).toBe("SCOPE");
    const answer = await composeAnswer(graphName, r, NS_ORG);
    expect(answer.text).toContain("Northstar Labs");
    expect(answer.text).not.toMatch(/Northgate|school/i);
  });
});

describe("FIX 3 — no silent fallback to a different root", () => {
  it.each([
    "what is exposed if Acme Corporation's CFO resigns?",
    "what happens if Globex Industries loses its database?",
  ])("refuses %s instead of answering about the gateway", async (q) => {
    const r = resolveQuestion(q, facts, NORTHSTAR_PACK.scenarioRootId);
    expect(r.intent).toBe("UNSUPPORTED");
    expect(r.rootEntityId).toBeNull();

    const answer = await composeAnswer(graphName, r, NS_ORG);
    expect(answer.supported).toBe(false);
    expect(answer.analysis).toBeNull();
    // It must say what the dataset DOES contain.
    expect(answer.text).toMatch(/does not contain|loaded graph contains/i);
  }, 60_000);

  it("still answers a question that names a real entity", async () => {
    const r = resolveQuestion(
      "what is exposed if AI Inference Gateway becomes unavailable?",
      facts,
      NORTHSTAR_PACK.scenarioRootId,
    );
    expect(r.intent).toBe("IMPACT");
    expect(r.rootEntityId).toBe("ns_svc_inference_gateway");
  });
});
