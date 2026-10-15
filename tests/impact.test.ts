/**
 * Golden integration tests — Tests 1, 2, 3, 4, 6.
 *
 * These run against a REAL FalkorDB instance on a graph created for this run.
 * Nothing here is mocked. If the database is unreachable the suite fails.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyseImpact, recheckDistinctCount, DEFAULT_DEPTH } from "../src/lib/engine/impact";
import { seedEducationGraph } from "../src/lib/graph/seed";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import {
  SCENARIO_ROOT_ENTITY_ID,
  DECOY_ENTITY_IDS,
  DEPENDENCIES,
} from "../src/domain/education/seed-data";
import type { ImpactAnalysis } from "../src/lib/engine/types";
import { uniqueTestGraph, cleanupGraph } from "./helpers";

const graphName = uniqueTestGraph("impact");
let analysis: ImpactAnalysis;

beforeAll(async () => {
  await seedEducationGraph(graphName);
  analysis = await analyseImpact(graphName, SCENARIO_ROOT_ENTITY_ID);
}, 120_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("Test 1 — multi-hop discovery", () => {
  it("discovers an entity that is only reachable through intermediate nodes", () => {
    const exam = analysis.impacted.find((e) => e.entityId === "ent_exam_waec_mock_physics");
    expect(exam, "the WAEC mock exam must be discovered").toBeDefined();
    // It has no direct edge to the teacher; every route is >= 2 hops.
    expect(Math.min(...exam!.allPaths.map((p) => p.edgeHops))).toBeGreaterThanOrEqual(2);
  });

  it("reports a genuinely multi-hop shortest path for a class", () => {
    const cls = analysis.impacted.find((e) => e.entityId === "ent_class_ss3_physics");
    expect(cls).toBeDefined();
    expect(cls!.shortestPath.edgeHops).toBe(2);
    expect(cls!.shortestPath.nodes.map((n) => n.id)).toEqual([
      "ent_class_ss3_physics",
      "ent_assign_physics_ss3",
      "ent_person_okonkwo",
    ]);
  });

  it("distinguishes edgeHops from entityHops across an intermediary node", () => {
    const cls = analysis.impacted.find((e) => e.entityId === "ent_class_ss3_physics")!;
    // class -> assignment(intermediary) -> person : 2 edges, 1 real transition.
    expect(cls.shortestPath.edgeHops).toBe(2);
    expect(cls.shortestPath.entityHops).toBe(1);
    expect(cls.shortestPath.entityHops).not.toBe(cls.shortestPath.edgeHops);
  });

  it("every returned path corresponds to real relationships in FalkorDB", async () => {
    const validEdges = new Set(DEPENDENCIES.map((d) => `${d.from}>${d.to}`));
    for (const entity of analysis.impacted) {
      for (const path of entity.allPaths) {
        for (let i = 0; i < path.nodes.length - 1; i += 1) {
          const from = path.nodes[i]!.id;
          const to = path.nodes[i + 1]!.id;
          expect(validEdges.has(`${from}>${to}`), `edge ${from}->${to} must exist`).toBe(true);

          // Confirm against the database too, not just the seed constants.
          const res = await roQuery<{ c: number }>(
            graphName,
            `MATCH (a:Entity {id: $from})-[r:DEPENDS_ON]->(b:Entity {id: $to}) RETURN count(r) AS c`,
            { params: { from, to } },
          );
          expect(res.data[0]?.c ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("Test 2 — decoy exclusion", () => {
  it("excludes entities with similar vocabulary but no dependency path", () => {
    const foundIds = new Set(analysis.impacted.map((e) => e.entityId));
    for (const decoy of DECOY_ENTITY_IDS) {
      expect(foundIds.has(decoy), `decoy ${decoy} must NOT be reported`).toBe(false);
    }
  });

  it("excludes SS1 Physics even though its name matches the affected subject", () => {
    const names = analysis.impacted.map((e) => e.name);
    expect(names).not.toContain("SS1 Physics");
    // ...while genuinely affected physics classes ARE present, proving the
    // exclusion is structural rather than a blanket name filter.
    expect(names).toContain("SS2 Physics");
    expect(names).toContain("SS3 Physics");
  });

  it("the decoy exists in the graph, so exclusion is a real traversal result", async () => {
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:Entity {id: 'ent_class_ss1_physics'}) RETURN count(n) AS c`,
    );
    expect(res.data[0]?.c).toBe(1);
  });

  it("never reports the root entity as impacted by itself", () => {
    expect(analysis.impacted.map((e) => e.entityId)).not.toContain(SCENARIO_ROOT_ENTITY_ID);
  });
});

describe("Test 3 — provenance", () => {
  it("every impacted entity carries at least one evidence reference", () => {
    expect(analysis.impacted.length).toBeGreaterThan(0);
    for (const e of analysis.impacted) {
      expect(e.evidence.length, `${e.entityId} must have evidence`).toBeGreaterThan(0);
    }
  });

  it("every evidence reference resolves to a real Source node in FalkorDB", async () => {
    for (const e of analysis.impacted) {
      for (const ev of e.evidence) {
        const res = await roQuery<{ reference: string; excerpt: string }>(
          graphName,
          `MATCH (s:Source {id: $id}) RETURN s.reference AS reference, s.excerpt AS excerpt`,
          { params: { id: ev.sourceId } },
        );
        expect(res.data.length, `source ${ev.sourceId} must exist`).toBe(1);
        expect(res.data[0]!.reference).toBe(ev.reference);
        expect(res.data[0]!.excerpt).toBe(ev.excerpt);
        expect(ev.excerpt.length).toBeGreaterThan(0);
      }
    }
  });

  it("reports no unevidenced edges for the seeded scenario", () => {
    expect(analysis.unevidencedEntityIds).toEqual([]);
  });

  it("labels every finding OBSERVED with a versioned rule id", () => {
    for (const e of analysis.impacted) {
      expect(e.claim).toBe("OBSERVED");
      expect(e.ruleId).toMatch(/@\d+$/);
    }
  });
});

describe("Test 4 — relationship uniqueness / multiple paths", () => {
  it("counts an entity reached by several routes exactly once", () => {
    const ids = analysis.impacted.map((e) => e.entityId);
    expect(new Set(ids).size).toBe(ids.length);

    const exam = analysis.impacted.filter((e) => e.entityId === "ent_exam_waec_mock_physics");
    expect(exam.length).toBe(1);
  });

  it("preserves the alternative evidence paths for inspection", () => {
    const exam = analysis.impacted.find((e) => e.entityId === "ent_exam_waec_mock_physics")!;
    expect(exam.allPaths.length).toBeGreaterThan(1);

    const routes = exam.allPaths.map((p) => p.nodes.map((n) => n.id).join(" -> "));
    expect(new Set(routes).size, "alternative routes must be distinct").toBe(routes.length);

    const lab = analysis.impacted.find((e) => e.entityId === "ent_resp_lab_practical")!;
    expect(lab.allPaths.length).toBe(2);
    expect(lab.allPaths[0]!.edgeHops).toBe(1);
    expect(lab.allPaths[1]!.edgeHops).toBe(2);
  });

  it("does not mistake path count for distinct entity count", () => {
    expect(analysis.totalPathCount).toBeGreaterThan(analysis.distinctImpactedCount);
    expect(analysis.distinctImpactedCount).toBe(analysis.impacted.length);
  });

  it("agrees with an independently formulated re-check query", async () => {
    const recheck = await recheckDistinctCount(graphName, SCENARIO_ROOT_ENTITY_ID, DEFAULT_DEPTH);
    expect(recheck).toBe(analysis.distinctImpactedCount);
  });
});

describe("Test 6 — cycle safety", () => {
  it("terminates and returns a bounded result despite a governance cycle", async () => {
    // committee -> coordination -> committee is a real cycle in the seed.
    const cyclePair = analysis.impacted.filter((e) =>
      ["ent_committee_examinations", "ent_resp_exam_coordination"].includes(e.entityId),
    );
    expect(cyclePair.length).toBe(2);
  });

  it("does not inflate distinct counts via the cycle", () => {
    const ids = analysis.impacted.map((e) => e.entityId);
    expect(ids.filter((i) => i === "ent_committee_examinations").length).toBe(1);
    expect(ids.filter((i) => i === "ent_resp_exam_coordination").length).toBe(1);
  });

  it("emits no path that revisits a node", () => {
    for (const e of analysis.impacted) {
      for (const p of e.allPaths) {
        const ids = p.nodes.map((n) => n.id);
        expect(new Set(ids).size, `path ${ids.join(">")} must not revisit a node`).toBe(
          ids.length,
        );
      }
    }
  });

  it("stays bounded as depth increases, converging on a stable answer", async () => {
    const deep = await analyseImpact(graphName, SCENARIO_ROOT_ENTITY_ID, { maxDepth: 8 });
    expect(deep.distinctImpactedCount).toBe(analysis.distinctImpactedCount);
    // Path counts must also stabilise: an unbounded cycle would keep growing.
    expect(deep.totalPathCount).toBe(analysis.totalPathCount);
  }, 60_000);

  it("rejects an out-of-range depth instead of running an unbounded query", async () => {
    await expect(
      analyseImpact(graphName, SCENARIO_ROOT_ENTITY_ID, { maxDepth: 99 }),
    ).rejects.toThrow(/depth must be an integer/i);
  });
});
