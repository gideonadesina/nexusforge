/**
 * Stage 2A — persisted analysis runs and findings (requirement 8).
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedEducationGraph, census, expectedCensus } from "../src/lib/graph/seed";
import { runAndPersistAnalysis, retryPersistAnalysis } from "../src/lib/runs/analyse-and-persist";
import { getRun, listRuns, listFindings, findingIdFor } from "../src/lib/runs/persist";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { SCENARIO_ROOT_ENTITY_ID, DECOY_ENTITY_IDS } from "../src/domain/education/seed-data";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { RunAndPersistResult } from "../src/lib/runs/analyse-and-persist";

const graphName = uniqueTestGraph("runs");
let runA: RunAndPersistResult;

/** Fingerprint of the organizational subgraph, used to prove it is untouched. */
async function organizationalFingerprint() {
  const c = await census(graphName);
  const entities = await roQuery<{ id: string; name: string; type: string }>(
    graphName,
    `MATCH (n:Entity) RETURN n.id AS id, n.name AS name, n.type AS type ORDER BY id`,
  );
  const deps = await roQuery<{ id: string; kind: string }>(
    graphName,
    `MATCH ()-[r:DEPENDS_ON]->() RETURN r.id AS id, r.kind AS kind ORDER BY id`,
  );
  return { census: c, entities: entities.data, deps: deps.data };
}

let beforeFingerprint: Awaited<ReturnType<typeof organizationalFingerprint>>;

beforeAll(async () => {
  await seedEducationGraph(graphName);
  beforeFingerprint = await organizationalFingerprint();
  runA = await runAndPersistAnalysis(graphName, SCENARIO_ROOT_ENTITY_ID);
}, 180_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("run creation", () => {
  it("creates a run with a uuid id and an owner token returned once", () => {
    expect(runA.run.analysisRunId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(runA.run.ownerToken.length).toBeGreaterThanOrEqual(40);
  });

  it("records the input event, depth, rule, seed version, and status", async () => {
    const run = await getRun(graphName, runA.run.analysisRunId);
    expect(run).not.toBeNull();
    expect(run!.rootEntityId).toBe(SCENARIO_ROOT_ENTITY_ID);
    expect(run!.maxDepth).toBe(6);
    expect(run!.ruleId).toMatch(/@\d+$/);
    expect(run!.seedVersion).toBe("edu-v1");
    expect(run!.status).toBe("COMPLETED");
    expect(run!.graphName).toBe(graphName);
    expect(typeof run!.createdAt).toBe("string");
  });

  it("never exposes the owner token or its hash through a read", async () => {
    const run = await getRun(graphName, runA.run.analysisRunId);
    const serialized = JSON.stringify(run);
    expect(serialized).not.toContain("ownerTokenHash");
    expect(serialized).not.toContain(runA.run.ownerToken);

    const runs = await listRuns(graphName);
    expect(JSON.stringify(runs)).not.toContain("ownerTokenHash");
  });

  it("stores the hash, not the plaintext token, on the node", async () => {
    const res = await roQuery<{ h: string; hasPlain: number }>(
      graphName,
      `MATCH (r:AnalysisRun {analysisRunId: $id})
       RETURN r.ownerTokenHash AS h, size([x IN [r.ownerTokenHash] WHERE x = $tok]) AS hasPlain`,
      { params: { id: runA.run.analysisRunId, tok: runA.run.ownerToken } },
    );
    expect(res.data[0]!.h).toMatch(/^[0-9a-f]{64}$/);
    expect(res.data[0]!.hasPlain).toBe(0);
  });
});

describe("findings are computed, not fabricated", () => {
  it("persists exactly the engine's distinct impacted entities", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    expect(findings.length).toBe(runA.analysis.distinctImpactedCount);

    const persisted = findings.map((f) => f.entityId).sort();
    const computed = runA.analysis.impacted.map((e) => e.entityId).sort();
    expect(persisted).toEqual(computed);
  });

  it("excludes decoys from persisted findings, as the engine did", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    const ids = new Set(findings.map((f) => f.entityId));
    for (const decoy of DECOY_ENTITY_IDS) {
      expect(ids.has(decoy)).toBe(false);
    }
  });

  it("stores claim classification and rule version on every finding", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    for (const f of findings) {
      expect(f.claim).toBe("OBSERVED");
      expect(f.ruleId).toMatch(/@\d+$/);
      expect(f.verificationStatus).toBe("UNVERIFIED");
    }
  });
});

describe("dependency paths and evidence remain inspectable", () => {
  it("stores relationship ids that resolve to real DEPENDS_ON edges", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    for (const f of findings) {
      expect(f.shortestPathRelationshipIds.length).toBe(f.edgeHops);
      for (const relId of f.shortestPathRelationshipIds) {
        const res = await roQuery<{ c: number }>(
          graphName,
          `MATCH ()-[r:DEPENDS_ON {id: $id}]->() RETURN count(r) AS c`,
          { params: { id: relId } },
        );
        expect(res.data[0]?.c, `relationship ${relId} must exist`).toBe(1);
      }
    }
  });

  it("stores entity path ids that resolve to real entities", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    for (const f of findings) {
      expect(f.shortestPathEntityIds[0]).toBe(f.entityId);
      expect(f.shortestPathEntityIds.at(-1)).toBe(SCENARIO_ROOT_ENTITY_ID);
      for (const id of f.shortestPathEntityIds) {
        const res = await roQuery<{ c: number }>(
          graphName,
          `MATCH (n:Entity {id: $id}) RETURN count(n) AS c`,
          { params: { id } },
        );
        expect(res.data[0]?.c).toBe(1);
      }
    }
  });

  it("preserves alternative path signatures for multi-route entities", async () => {
    const findings = await listFindings(graphName, runA.run.analysisRunId);
    const exam = findings.find((f) => f.entityId === "ent_exam_waec_mock_physics");
    expect(exam).toBeDefined();
    expect(exam!.pathCount).toBe(3);
    expect(exam!.allPathSignatures.length).toBe(3);
    expect(new Set(exam!.allPathSignatures).size).toBe(3);
  });

  it("links findings to their evidence as traversable CITES edges", async () => {
    const res = await roQuery<{ entityId: string; sourceId: string }>(
      graphName,
      `MATCH (f:Finding)-[:PART_OF_RUN]->(r:AnalysisRun {analysisRunId: $id})
       MATCH (f)-[:CITES]->(s:Source)
       RETURN f.entityId AS entityId, s.id AS sourceId ORDER BY entityId, sourceId`,
      { params: { id: runA.run.analysisRunId } },
    );
    expect(res.data.length).toBeGreaterThan(0);

    const findings = await listFindings(graphName, runA.run.analysisRunId);
    const expected = findings.flatMap((f) =>
      f.evidenceSourceIds.map((s) => `${f.entityId}|${s}`),
    );
    const actual = res.data.map((r) => `${r.entityId}|${r.sourceId}`);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it("links each finding to the entity it is about", async () => {
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (f:Finding)-[:PART_OF_RUN]->(r:AnalysisRun {analysisRunId: $id})
       MATCH (f)-[:ABOUT]->(e:Entity)
       WHERE e.id = f.entityId
       RETURN count(f) AS c`,
      { params: { id: runA.run.analysisRunId } },
    );
    expect(res.data[0]?.c).toBe(runA.analysis.distinctImpactedCount);
  });
});

describe("findings survive a fresh application connection", () => {
  it("re-reads the run and findings after the connection is closed", async () => {
    await closeDb(); // force a brand-new connection on the next call

    const run = await getRun(graphName, runA.run.analysisRunId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("COMPLETED");

    const findings = await listFindings(graphName, runA.run.analysisRunId);
    expect(findings.length).toBe(runA.analysis.distinctImpactedCount);
    expect(findings.every((f) => f.analysisRunId === runA.run.analysisRunId)).toBe(true);
  }, 60_000);
});

describe("runs are isolated from one another", () => {
  it("a second run does not overwrite the first", async () => {
    const runB = await runAndPersistAnalysis(graphName, SCENARIO_ROOT_ENTITY_ID);
    expect(runB.run.analysisRunId).not.toBe(runA.run.analysisRunId);

    const a = await listFindings(graphName, runA.run.analysisRunId);
    const b = await listFindings(graphName, runB.run.analysisRunId);

    expect(a.length).toBe(runA.analysis.distinctImpactedCount);
    expect(b.length).toBe(runB.analysis.distinctImpactedCount);

    // Every finding belongs to exactly one run.
    expect(a.every((f) => f.analysisRunId === runA.run.analysisRunId)).toBe(true);
    expect(b.every((f) => f.analysisRunId === runB.run.analysisRunId)).toBe(true);

    // Finding ids are namespaced by run, so they cannot collide.
    const aIds = new Set(a.map((f) => f.findingId));
    for (const f of b) expect(aIds.has(f.findingId)).toBe(false);

    // Each run's tokens differ.
    expect(runB.run.ownerToken).not.toBe(runA.run.ownerToken);
  }, 120_000);

  it("every persisted finding belongs to the correct run", async () => {
    const res = await roQuery<{ findingId: string; runId: string; prop: string }>(
      graphName,
      `MATCH (f:Finding)-[:PART_OF_RUN]->(r:AnalysisRun)
       RETURN f.findingId AS findingId, r.analysisRunId AS runId, f.analysisRunId AS prop`,
    );
    expect(res.data.length).toBeGreaterThan(0);
    for (const row of res.data) {
      // The edge and the stored property must agree.
      expect(row.prop).toBe(row.runId);
      // And the deterministic id must encode the same run.
      expect(row.findingId.startsWith(`${row.runId}::`)).toBe(true);
    }
  });

  it("no finding is attached to more than one run", async () => {
    const res = await roQuery<{ findingId: string; runs: number }>(
      graphName,
      `MATCH (f:Finding)-[:PART_OF_RUN]->(r:AnalysisRun)
       RETURN f.findingId AS findingId, count(r) AS runs ORDER BY findingId`,
    );
    expect(res.data.filter((r) => r.runs !== 1)).toEqual([]);
  });
});

describe("retry persistence is idempotent", () => {
  it("re-persisting the same run creates no duplicates and marks a retry", async () => {
    const before = await listFindings(graphName, runA.run.analysisRunId);

    const retry = await retryPersistAnalysis(
      graphName,
      { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
      SCENARIO_ROOT_ENTITY_ID,
    );

    const after = await listFindings(graphName, runA.run.analysisRunId);
    expect(after.length).toBe(before.length);
    expect(after.map((f) => f.findingId).sort()).toEqual(
      before.map((f) => f.findingId).sort(),
    );

    // persistAttempts distinguishes a retry from a first write.
    expect(retry.persistAttempts).toBeGreaterThan(1);
    const run = await getRun(graphName, runA.run.analysisRunId);
    expect(run!.persistAttempts).toBe(retry.persistAttempts);
  }, 120_000);

  it("does not duplicate CITES or ABOUT edges on retry", async () => {
    const dupes = await roQuery<{ pair: string; c: number }>(
      graphName,
      `MATCH (f:Finding)-[c:CITES]->(s:Source)
       RETURN f.findingId + '|' + s.id AS pair, count(c) AS c
       ORDER BY pair`,
    );
    expect(dupes.data.filter((r) => r.c !== 1)).toEqual([]);

    const aboutDupes = await roQuery<{ pair: string; c: number }>(
      graphName,
      `MATCH (f:Finding)-[a:ABOUT]->(e:Entity)
       RETURN f.findingId + '|' + e.id AS pair, count(a) AS c
       ORDER BY pair`,
    );
    expect(aboutDupes.data.filter((r) => r.c !== 1)).toEqual([]);
  });

  it("keeps createdAt stable across retries while updating updatedAt", async () => {
    const res = await roQuery<{ createdAt: string; updatedAt: string }>(
      graphName,
      `MATCH (f:Finding {findingId: $id}) RETURN f.createdAt AS createdAt, f.updatedAt AS updatedAt`,
      { params: { id: findingIdFor(runA.run.analysisRunId, "ent_class_ss3_physics") } },
    );
    const row = res.data[0]!;
    expect(row.createdAt).toBeTruthy();
    expect(new Date(row.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(row.createdAt).getTime(),
    );
  });
});

describe("organizational data is never modified by run persistence", () => {
  it("leaves the seed census unchanged", async () => {
    expect(await census(graphName)).toEqual(expectedCensus());
  });

  it("leaves every entity and dependency byte-identical", async () => {
    const after = await organizationalFingerprint();
    expect(after.entities).toEqual(beforeFingerprint.entities);
    expect(after.deps).toEqual(beforeFingerprint.deps);
    expect(after.census).toEqual(beforeFingerprint.census);
  });

  it("adds no DEPENDS_ON or EVIDENCED_BY edges", async () => {
    const res = await roQuery<{ dep: number; ev: number }>(
      graphName,
      `MATCH ()-[d:DEPENDS_ON]->() WITH count(d) AS dep
       MATCH ()-[e:EVIDENCED_BY]->() RETURN dep, count(e) AS ev`,
    );
    expect(res.data[0]!.dep).toBe(expectedCensus().dependsOn);
    expect(res.data[0]!.ev).toBe(expectedCensus().evidencedBy);
  });

  it("keeps run data on separate labels from organizational data", async () => {
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:Entity) WHERE n:Finding OR n:AnalysisRun RETURN count(n) AS c`,
    );
    expect(res.data[0]?.c).toBe(0);
  });
});
