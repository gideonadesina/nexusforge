/**
 * Stage 2B Priority 1 — evidence correctness.
 *
 * Builds a graph containing a DELIBERATE evidence gap: an edge citing a
 * source id that has no Source node. Proves the engine reports the gap
 * explicitly instead of presenting an unsupported conclusion as fact.
 *
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyseImpact, classifyExposure, assertVerifiableOnlyIfSupported } from "../src/lib/engine/impact";
import { writeQuery, closeDb } from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { DependencyPath, ImpactAnalysis } from "../src/lib/engine/types";

const graphName = uniqueTestGraph("evidence");
let analysis: ImpactAnalysis;

/**
 * Fixture:
 *   root            <- direct_ok        (1 hop, evidence resolves)  => OBSERVED
 *   root            <- direct_bad       (1 hop, DANGLING source)    => DERIVED, MISSING
 *   direct_ok       <- two_hop_ok       (2 hops, all resolve)       => DERIVED, COMPLETE
 *   direct_bad      <- two_hop_partial  (2 hops, one resolves)      => DERIVED, PARTIAL
 *   root            <- no_source        (1 hop, cites nothing)      => DERIVED, MISSING
 */
beforeAll(async () => {
  await writeQuery(
    graphName,
    `
CREATE (root:Entity {id:'root', type:'Person', name:'Root', intermediary:false}),
       (ok:Entity   {id:'direct_ok', type:'Duty', name:'Direct OK', intermediary:false}),
       (bad:Entity  {id:'direct_bad', type:'Duty', name:'Direct Bad', intermediary:false}),
       (t1:Entity   {id:'two_hop_ok', type:'Task', name:'Two Hop OK', intermediary:false}),
       (t2:Entity   {id:'two_hop_partial', type:'Task', name:'Two Hop Partial', intermediary:false}),
       (ns:Entity   {id:'no_source', type:'Duty', name:'No Source Cited', intermediary:false}),
       (s1:Source {id:'src_real_1', reference:'Real doc 1', excerpt:'excerpt one', sourceType:'doc'}),
       (s2:Source {id:'src_real_2', reference:'Real doc 2', excerpt:'excerpt two', sourceType:'doc'}),
       (ok)-[:DEPENDS_ON {id:'e1', kind:'k', sourceId:'src_real_1'}]->(root),
       (bad)-[:DEPENDS_ON {id:'e2', kind:'k', sourceId:'src_DANGLING'}]->(root),
       (t1)-[:DEPENDS_ON {id:'e3', kind:'k', sourceId:'src_real_2'}]->(ok),
       (t2)-[:DEPENDS_ON {id:'e4', kind:'k', sourceId:'src_real_2'}]->(bad),
       (ns)-[:DEPENDS_ON {id:'e5', kind:'k'}]->(root)
RETURN 1 AS ok
`.trim(),
  );
  analysis = await analyseImpact(graphName, "root", { maxDepth: 4 });
}, 120_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

const find = (id: string) => analysis.impacted.find((e) => e.entityId === id)!;

describe("OBSERVED means directly evidenced", () => {
  it("labels a 1-hop dependency with resolving evidence OBSERVED", () => {
    const e = find("direct_ok");
    expect(e.claim).toBe("OBSERVED");
    expect(e.evidenceStatus).toBe("COMPLETE");
    expect(e.supported).toBe(true);
    expect(e.unresolvedSourceIds).toEqual([]);
  });

  it("does NOT label a 1-hop dependency OBSERVED when its evidence dangles", () => {
    const e = find("direct_bad");
    expect(e.claim).toBe("DERIVED");
    expect(e.evidenceStatus).toBe("MISSING");
    expect(e.supported).toBe(false);
    expect(e.unresolvedSourceIds).toContain("src_DANGLING");
  });

  it("does NOT label a 1-hop dependency OBSERVED when it cites no source", () => {
    const e = find("no_source");
    expect(e.claim).toBe("DERIVED");
    expect(e.evidenceStatus).toBe("MISSING");
    expect(e.supported).toBe(false);
    expect(e.unresolvedSourceIds.some((s) => s.includes("no-source-cited"))).toBe(true);
  });
});

describe("DERIVED means rule-based conclusion", () => {
  it("labels a fully evidenced 2-hop conclusion DERIVED, not OBSERVED", () => {
    const e = find("two_hop_ok");
    expect(e.claim).toBe("DERIVED");
    expect(e.evidenceStatus).toBe("COMPLETE");
    expect(e.supported).toBe(true);
  });

  it("reports PARTIAL when some edges resolve and some do not", () => {
    const e = find("two_hop_partial");
    expect(e.claim).toBe("DERIVED");
    expect(e.evidenceStatus).toBe("PARTIAL");
    expect(e.supported).toBe(false);
    expect(e.unresolvedSourceIds).toContain("src_DANGLING");
  });
});

describe("gaps are explicit and never invented", () => {
  it("lists every entity whose evidence does not fully resolve", () => {
    expect(analysis.unevidencedEntityIds.sort()).toEqual(
      ["direct_bad", "no_source", "two_hop_partial"].sort(),
    );
  });

  it("never fabricates an evidence record for a dangling reference", () => {
    for (const e of analysis.impacted) {
      for (const ev of e.evidence) {
        expect(ev.sourceId).not.toBe("src_DANGLING");
        expect(ev.excerpt.length).toBeGreaterThan(0);
      }
    }
  });

  it("counts resolved evidence honestly per path", () => {
    expect(find("two_hop_partial").shortestPath.evidence.length).toBe(1);
    expect(find("direct_bad").shortestPath.evidence.length).toBe(0);
  });
});

describe("unsupported conclusions can never be verified", () => {
  it("throws if something tries to mark an unsupported finding VERIFIED", () => {
    expect(() => assertVerifiableOnlyIfSupported(false, "VERIFIED")).toThrow(/unsupported/i);
  });

  it("permits VERIFIED only for supported findings", () => {
    expect(() => assertVerifiableOnlyIfSupported(true, "VERIFIED")).not.toThrow();
    expect(() => assertVerifiableOnlyIfSupported(false, "UNVERIFIED")).not.toThrow();
  });
});

describe("classifyExposure picks the best-evidenced route", () => {
  const path = (edgeHops: number, status: DependencyPath["evidenceStatus"]): DependencyPath => ({
    nodes: [],
    relationshipIds: [],
    edgeHops,
    entityHops: edgeHops,
    evidence: [],
    evidenceStatus: status,
    unresolvedSourceIds: status === "COMPLETE" ? [] : ["gap"],
  });

  it("prefers a complete longer route over a broken short one", () => {
    const r = classifyExposure([path(1, "MISSING"), path(3, "COMPLETE")]);
    // Supported via the long route, but 3 hops means it is DERIVED.
    expect(r.claim).toBe("DERIVED");
    expect(r.evidenceStatus).toBe("COMPLETE");
    expect(r.supported).toBe(true);
  });

  it("returns OBSERVED only when the best route is a single evidenced hop", () => {
    expect(classifyExposure([path(1, "COMPLETE"), path(2, "COMPLETE")]).claim).toBe("OBSERVED");
  });

  it("is unsupported when no route resolves", () => {
    const r = classifyExposure([path(1, "MISSING"), path(2, "MISSING")]);
    expect(r.supported).toBe(false);
    expect(r.claim).toBe("DERIVED");
  });

  it("fails closed on an empty route list", () => {
    const r = classifyExposure([]);
    expect(r.supported).toBe(false);
    expect(r.claim).toBe("DERIVED");
    expect(r.evidenceStatus).toBe("MISSING");
  });
});
