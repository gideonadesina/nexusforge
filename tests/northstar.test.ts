/**
 * Northstar Labs scenario — the four features that make it worth demonstrating.
 *
 * Each is asserted against the real traversal, so none of them can quietly
 * stop working. Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedGraph } from "../src/lib/graph/seed";
import { analyseImpact } from "../src/lib/engine/impact";
import { generateProposals } from "../src/lib/actions/rules";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { NORTHSTAR_PACK } from "../src/lib/org/packs";
import {
  SCENARIO_ROOT_ENTITY_ID,
  DECOY_ENTITY_IDS,
  SURPRISING_FINDING_ID,
} from "../src/domain/northstar/seed-data";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { ImpactAnalysis } from "../src/lib/engine/types";

const graphName = uniqueTestGraph("northstar");
let analysis: ImpactAnalysis;

beforeAll(async () => {
  await seedGraph(graphName, NORTHSTAR_PACK);
  analysis = await analyseImpact(graphName, SCENARIO_ROOT_ENTITY_ID);
}, 240_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

const find = (id: string) => analysis.impacted.find((e) => e.entityId === id);

describe("the engine is reused unchanged", () => {
  it("produces a multi-hop result from the same traversal", () => {
    expect(analysis.distinctImpactedCount).toBeGreaterThan(5);
    expect(analysis.totalPathCount).toBeGreaterThan(analysis.distinctImpactedCount);
  });

  it("classifies claims with the same rule as the education pack", () => {
    for (const e of analysis.impacted) {
      expect(["OBSERVED", "DERIVED"]).toContain(e.claim);
      if (e.claim === "OBSERVED") {
        expect(e.shortestPath.edgeHops).toBe(1);
        expect(e.evidenceStatus).toBe("COMPLETE");
      }
    }
  });

  it("carries no education vocabulary", () => {
    const blob = JSON.stringify(analysis).toLowerCase();
    for (const word of ["teacher", "physics", "waec", "classroom", "pupil"]) {
      expect(blob).not.toContain(word);
    }
  });
});

describe("A — the hidden asynchronous dependency", () => {
  it("exposes an enterprise customer commitment through the event topic", () => {
    const hit = find(SURPRISING_FINDING_ID);
    expect(hit, "the Meridian commitment must be discovered").toBeDefined();
    // Not a direct service-to-service link: it takes several relationships.
    expect(hit!.shortestPath.edgeHops).toBeGreaterThanOrEqual(4);
    expect(hit!.claim).toBe("DERIVED");
  });

  it("routes through the topic, the audit processor and the obligation", () => {
    const chain = find(SURPRISING_FINDING_ID)!.shortestPath.nodes.map((n) => n.id);
    expect(chain).toContain("ns_obligation_soc2_evidence");
    expect(chain).toContain("ns_svc_audit_processor");
    expect(chain).toContain("ns_topic_inference_events");
    expect(chain.at(-1)).toBe(SCENARIO_ROOT_ENTITY_ID);
  });

  it("has no direct edge from the commitment to the gateway", async () => {
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (a:Entity {id:$a})-[r:DEPENDS_ON]->(b:Entity {id:$b}) RETURN count(r) AS c`,
      { params: { a: SURPRISING_FINDING_ID, b: SCENARIO_ROOT_ENTITY_ID } },
    );
    // The finding is genuinely indirect, not a shortcut dressed up as one.
    expect(res.data[0]?.c).toBe(0);
  });

  it("reaches the obligation by two independent routes", () => {
    const obligation = find("ns_obligation_soc2_evidence")!;
    expect(obligation.allPaths.length).toBeGreaterThan(1);
  });
});

describe("B — the ownership gap", () => {
  it("surfaces the on-call assignment covering failover", () => {
    const assignment = find("ns_assign_oncall_gateway");
    expect(assignment).toBeDefined();
  });

  it("carries roster evidence naming the departure and no deputy", async () => {
    const res = await roQuery<{ excerpt: string }>(
      graphName,
      `MATCH (s:Source {id:'src_ns_oncall_roster'}) RETURN s.excerpt AS excerpt`,
    );
    const excerpt = res.data[0]!.excerpt;
    expect(excerpt).toMatch(/left the organization/i);
    expect(excerpt).toMatch(/no deputy/i);
  });

  it("does NOT invent a replacement owner", () => {
    // No entity anywhere claims to be a qualified or available substitute.
    const blob = JSON.stringify(analysis).toLowerCase();
    for (const invented of ["replacement", "substitute", "qualified", "available deputy"]) {
      expect(blob).not.toContain(invented);
    }
  });

  it("leaves the departed person out of the impact set", () => {
    // A person who left does not depend on the gateway; they are a
    // dependency of the assignment, not an exposed entity.
    expect(find("ns_person_okafor")).toBeUndefined();
  });
});

describe("C — the uncertain recovery constraint", () => {
  it("flags the external failover plan as unsupported", () => {
    const plan = find("ns_plan_failover_external");
    expect(plan, "the failover plan must appear").toBeDefined();
    expect(plan!.evidenceStatus).toBe("MISSING");
    expect(plan!.supported).toBe(false);
  });

  it("does not label it OBSERVED despite being one hop away", () => {
    // One hop, but the evidence does not resolve, so it degrades to DERIVED.
    const plan = find("ns_plan_failover_external")!;
    expect(plan.shortestPath.edgeHops).toBe(1);
    expect(plan.claim).toBe("DERIVED");
  });

  it("names the unresolved reference rather than hiding it", () => {
    const plan = find("ns_plan_failover_external")!;
    expect(plan.unresolvedSourceIds).toContain("src_ns_adr_014_current_status");
  });

  it("propagates uncertainty to the responsibility that executes it", () => {
    const resp = find("ns_resp_gateway_failover")!;
    expect(resp.evidenceStatus).toBe("PARTIAL");
    expect(resp.supported).toBe(false);
  });

  it("proposes closing the gap, not a workaround", () => {
    const drafts = generateProposals(analysis);
    const gapProposals = drafts.filter(
      (d) => d.ruleId === "rule.action.resolve-evidence-gap@1",
    );
    expect(gapProposals.length).toBeGreaterThan(0);
    for (const p of gapProposals) {
      expect(p.actionType).toBe("RESOLVE_EVIDENCE_GAP");
      expect(p.rationale).toMatch(/not fully supported|must not be acted on/i);
    }
  });
});

describe("D — the decoys are excluded", () => {
  it("excludes every declared decoy", () => {
    const ids = new Set(analysis.impacted.map((e) => e.entityId));
    for (const decoy of DECOY_ENTITY_IDS) {
      expect(ids.has(decoy), `${decoy} must not be reported`).toBe(false);
    }
  });

  it("the decoys genuinely exist, so exclusion is structural", async () => {
    for (const decoy of DECOY_ENTITY_IDS) {
      const res = await roQuery<{ c: number }>(
        graphName,
        `MATCH (n:Entity {id:$id}) RETURN count(n) AS c`,
        { params: { id: decoy } },
      );
      expect(res.data[0]?.c).toBe(1);
    }
  });

  it("excludes a decoy event topic even though a topic IS on the real path", () => {
    // billing.events looks exactly like inference.events structurally.
    const ids = analysis.impacted.map((e) => e.entityId);
    expect(ids).toContain("ns_topic_inference_events");
    expect(ids).not.toContain("ns_topic_billing_events");
  });
});

describe("the scenario produces grounded action proposals", () => {
  it("proposes only where rules are supported by the graph", () => {
    const drafts = generateProposals(analysis);
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(analysis.impacted.some((e) => e.entityId === d.targetEntityId)).toBe(true);
    }
  });

  it("marks unsupported targets as unsupported in the proposal", () => {
    const drafts = generateProposals(analysis);
    const planProposal = drafts.find((d) => d.targetEntityId === "ns_plan_failover_external");
    expect(planProposal).toBeDefined();
    expect(planProposal!.supported).toBe(false);
  });
});
