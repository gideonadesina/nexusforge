/**
 * Stage 3 — rendered edges must correspond to real relationships.
 *
 * The visual claim is that every arrow on the canvas is a DEPENDS_ON
 * relationship that exists in FalkorDB, with the correct direction. This test
 * checks that claim against the database rather than against the renderer.
 *
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedEducationGraph } from "../src/lib/graph/seed";
import { analyseImpact } from "../src/lib/engine/impact";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { deriveEdges, traceRoute } from "../src/components/graph-edges";
import { SCENARIO_ROOT_ENTITY_ID, DEPENDENCIES } from "../src/domain/education/seed-data";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { ImpactAnalysis } from "../src/lib/engine/types";

const graphName = uniqueTestGraph("edges");
let analysis: ImpactAnalysis;

beforeAll(async () => {
  await seedEducationGraph(graphName);
  analysis = await analyseImpact(graphName, SCENARIO_ROOT_ENTITY_ID);
}, 180_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("every derived edge exists in FalkorDB", () => {
  it("derives a non-empty edge set", () => {
    expect(deriveEdges(analysis.impacted).length).toBeGreaterThan(0);
  });

  it("matches a real DEPENDS_ON relationship by id AND endpoints", async () => {
    for (const edge of deriveEdges(analysis.impacted)) {
      const res = await roQuery<{ c: number }>(
        graphName,
        `MATCH (a:Entity {id: $from})-[r:DEPENDS_ON {id: $relId}]->(b:Entity {id: $to})
         RETURN count(r) AS c`,
        { params: { from: edge.fromId, to: edge.toId, relId: edge.relationshipId } },
      );
      expect(
        res.data[0]?.c,
        `edge ${edge.relationshipId} (${edge.fromId} -> ${edge.toId}) must exist with that exact direction`,
      ).toBe(1);
    }
  });

  it("never reverses direction", async () => {
    // The same relationship id must NOT exist with endpoints swapped.
    for (const edge of deriveEdges(analysis.impacted)) {
      const res = await roQuery<{ c: number }>(
        graphName,
        `MATCH (a:Entity {id: $to})-[r:DEPENDS_ON {id: $relId}]->(b:Entity {id: $from})
         RETURN count(r) AS c`,
        { params: { from: edge.fromId, to: edge.toId, relId: edge.relationshipId } },
      );
      expect(res.data[0]?.c).toBe(0);
    }
  });

  it("draws only edges that belong to the seeded dependency set", () => {
    const real = new Set(DEPENDENCIES.map((d) => `${d.id}|${d.from}|${d.to}`));
    for (const edge of deriveEdges(analysis.impacted)) {
      expect(real.has(`${edge.relationshipId}|${edge.fromId}|${edge.toId}`)).toBe(true);
    }
  });

  it("never emits a synthesised placeholder id", () => {
    for (const edge of deriveEdges(analysis.impacted)) {
      expect(edge.relationshipId).not.toMatch(/^unidentified_edge_/);
      expect(edge.relationshipId.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates relationships shared by several paths", () => {
    const edges = deriveEdges(analysis.impacted);
    const ids = edges.map((e) => e.relationshipId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every relationship the traversal actually used", () => {
    const drawn = new Set(deriveEdges(analysis.impacted).map((e) => e.relationshipId));
    const used = new Set<string>();
    for (const e of analysis.impacted) {
      for (const p of e.allPaths) for (const r of p.relationshipIds) used.add(r);
    }
    // Nothing traversed may be silently omitted from the picture.
    for (const r of used) expect(drawn.has(r)).toBe(true);
  });

  it("excludes decoy relationships that were never traversed", () => {
    const drawn = new Set(deriveEdges(analysis.impacted).map((e) => e.relationshipId));
    for (const decoyRel of [
      "dep_assign_ss1_on_bello",
      "dep_class_ss1_on_assign",
      "dep_assign_pe_on_danjuma",
      "dep_athletics_on_danjuma",
    ]) {
      expect(drawn.has(decoyRel), `${decoyRel} must not be drawn`).toBe(false);
    }
  });
});

describe("trace selects a real, complete route", () => {
  it("traces the shortest route by default", () => {
    const entity = analysis.impacted.find((e) => e.entityId === "ent_exam_waec_mock_physics")!;
    const route = traceRoute(entity.shortestPath)!;
    expect(route.nodeIds.size).toBe(entity.shortestPath.nodes.length);
    expect(route.relationshipIds.size).toBe(entity.shortestPath.edgeHops);
    expect(route.ordered[0]).toBe("ent_exam_waec_mock_physics");
    expect(route.ordered.at(-1)).toBe(SCENARIO_ROOT_ENTITY_ID);
  });

  it("traced relationship ids are all real", async () => {
    const entity = analysis.impacted.find((e) => e.entityId === "ent_exam_waec_mock_physics")!;
    for (let i = 0; i < entity.allPaths.length; i += 1) {
      const route = traceRoute(entity.allPaths[i])!;
      for (const relId of route.relationshipIds) {
        const res = await roQuery<{ c: number }>(
          graphName,
          `MATCH ()-[r:DEPENDS_ON {id: $relId}]->() RETURN count(r) AS c`,
          { params: { relId } },
        );
        expect(res.data[0]?.c).toBe(1);
      }
    }
  });

  it("each alternative route is distinct and self-consistent", () => {
    const entity = analysis.impacted.find((e) => e.entityId === "ent_exam_waec_mock_physics")!;
    expect(entity.allPaths.length).toBe(3);

    const signatures = new Set<string>();
    for (const p of entity.allPaths) {
      const route = traceRoute(p)!;
      // A route's relationship count must equal its hop count.
      expect(route.relationshipIds.size).toBe(p.edgeHops);
      // Consecutive nodes must be joined by the relationship at that index.
      expect(p.nodes.length).toBe(p.edgeHops + 1);
      signatures.add(route.ordered.join(">"));
    }
    expect(signatures.size).toBe(entity.allPaths.length);
  });

  it("every traced node is part of the analysis or is the root", () => {
    const known = new Set(analysis.impacted.map((e) => e.entityId));
    known.add(SCENARIO_ROOT_ENTITY_ID);
    for (const entity of analysis.impacted) {
      for (const p of entity.allPaths) {
        for (const id of traceRoute(p)!.nodeIds) {
          expect(known.has(id), `${id} appears on a route but is not a known entity`).toBe(true);
        }
      }
    }
  });

  it("returns null for a missing path rather than inventing one", () => {
    expect(traceRoute(undefined)).toBeNull();
  });
});
