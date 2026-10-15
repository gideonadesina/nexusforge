/**
 * Stage 2B — DEFERRED ITEM: parallel-edge behaviour.
 *
 * Two distinct DEPENDS_ON relationships between the SAME pair of entities
 * (e.g. the same duty attested by two different documents).
 *
 * Full repair is explicitly deferred. This test exists to pin down what the
 * system actually does today, so the limitation is documented rather than
 * discovered during a demo. It asserts the behaviour we rely on (distinct
 * entity counting stays correct) and records the behaviour we have not fixed.
 *
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyseImpact } from "../src/lib/engine/impact";
import { writeQuery, closeDb } from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { ImpactAnalysis } from "../src/lib/engine/types";

const graphName = uniqueTestGraph("parallel");
let analysis: ImpactAnalysis;

beforeAll(async () => {
  await writeQuery(
    graphName,
    `
CREATE (root:Entity {id:'p_root', type:'Person', name:'Root', intermediary:false}),
       (dup:Entity  {id:'p_dup',  type:'Duty',   name:'Doubly Attested Duty', intermediary:false}),
       (s1:Source {id:'p_src_1', reference:'Roster A', excerpt:'duty assigned', sourceType:'doc'}),
       (s2:Source {id:'p_src_2', reference:'Contract B', excerpt:'duty assigned', sourceType:'doc'}),
       (dup)-[:DEPENDS_ON {id:'pe1', kind:'rostered_to', sourceId:'p_src_1'}]->(root),
       (dup)-[:DEPENDS_ON {id:'pe2', kind:'contracted_to', sourceId:'p_src_2'}]->(root)
RETURN 1 AS ok
`.trim(),
  );
  analysis = await analyseImpact(graphName, "p_root", { maxDepth: 4 });
}, 120_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("parallel edges — behaviour we rely on", () => {
  it("counts the doubly-attested entity exactly ONCE", () => {
    // This is the property that matters for correctness of impact counts.
    expect(analysis.distinctImpactedCount).toBe(1);
    expect(analysis.impacted.map((e) => e.entityId)).toEqual(["p_dup"]);
  });

  it("does not inflate the entity count by the number of parallel edges", () => {
    const occurrences = analysis.impacted.filter((e) => e.entityId === "p_dup").length;
    expect(occurrences).toBe(1);
  });

  it("still resolves evidence for the entity", () => {
    const e = analysis.impacted[0]!;
    expect(e.evidence.length).toBeGreaterThan(0);
    expect(e.evidenceStatus).toBe("COMPLETE");
    expect(e.supported).toBe(true);
  });

  it("classifies a single-hop doubly-attested dependency as OBSERVED", () => {
    expect(analysis.impacted[0]!.claim).toBe("OBSERVED");
    expect(analysis.impacted[0]!.shortestPath.edgeHops).toBe(1);
  });
});

describe("parallel edges — KNOWN LIMITATION, deliberately not repaired", () => {
  /**
   * Routes are deduplicated by their NODE signature ("p_dup>p_root"), not by
   * the relationship ids traversed. Two parallel edges therefore collapse to
   * one stored route, and the second attesting document is reachable through
   * the entity-level `evidence` list but NOT as a separate inspectable path.
   *
   * Impact: no effect on which entities are reported, their counts, their
   * claim class, or their evidence completeness. The loss is that
   * `allPaths.length` under-reports how many distinct relationship routes
   * exist when two edges connect the same pair.
   *
   * Not repaired because it cannot change any demo finding: the education
   * seed contains no parallel edges (verified — every DEPENDS_ON pair is
   * unique). Fixing it means keying path signatures on relationship ids
   * instead of node ids.
   */
  it("collapses parallel edges into a single stored route (under-reports paths)", () => {
    const e = analysis.impacted[0]!;
    expect(e.allPaths.length).toBe(1);
    // Honest record of what is lost: only one of the two edges is retained
    // as a traversable route.
    expect(e.shortestPath.relationshipIds.length).toBe(1);
    expect(["pe1", "pe2"]).toContain(e.shortestPath.relationshipIds[0]);
  });

  it("the total path count therefore does not equal the number of edges", () => {
    // Two real relationships exist in the graph...
    expect(analysis.totalPathCount).toBe(1);
    // ...but only one route is reported. Documented, not silently ignored.
  });
});

describe("the education seed contains no parallel edges", () => {
  it("confirms the limitation cannot affect demo findings", async () => {
    const { seedEducationGraph } = await import("../src/lib/graph/seed");
    const seedGraph = uniqueTestGraph("parallel_seedcheck");
    try {
      await seedEducationGraph(seedGraph);
      const { roQuery } = await import("../src/lib/falkor/client");
      const res = await roQuery<{ pair: string; c: number }>(
        seedGraph,
        `MATCH (a:Entity)-[r:DEPENDS_ON]->(b:Entity)
         RETURN a.id + '>' + b.id AS pair, count(r) AS c
         ORDER BY pair`,
      );
      const duplicated = res.data.filter((row) => row.c > 1);
      expect(duplicated, `parallel edges found: ${JSON.stringify(duplicated)}`).toEqual([]);
    } finally {
      await cleanupGraph(seedGraph);
    }
  }, 180_000);
});
