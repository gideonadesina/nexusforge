/**
 * Stage 2A — run-scoped authorization (requirement 11).
 *
 * Proves that an analysisRunId alone is NOT sufficient to mutate a run, and
 * that rejected mutations leave the database completely unchanged.
 *
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedEducationGraph, census, expectedCensus } from "../src/lib/graph/seed";
import { runAndPersistAnalysis, retryPersistAnalysis } from "../src/lib/runs/analyse-and-persist";
import { getRun, listFindings, adminDeleteRun } from "../src/lib/runs/persist";
import {
  withRunAuthorization,
  RunAuthorizationError,
  generateOwnerToken,
  hashOwnerToken,
  hashesEqual,
} from "../src/lib/runs/authz";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { SCENARIO_ROOT_ENTITY_ID } from "../src/domain/education/seed-data";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { RunAndPersistResult } from "../src/lib/runs/analyse-and-persist";

const graphName = uniqueTestGraph("authz");
let runA: RunAndPersistResult;
let runB: RunAndPersistResult;

/** Total graph state, used to prove a rejected mutation changed nothing. */
async function fullSnapshot() {
  const counts = await roQuery<{ label: string; c: number }>(
    graphName,
    `MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY label`,
  );
  const runs = await roQuery<{ id: string; status: string; attempts: number; updatedAt: string }>(
    graphName,
    `MATCH (r:AnalysisRun)
     RETURN r.analysisRunId AS id, r.status AS status,
            r.persistAttempts AS attempts, r.updatedAt AS updatedAt
     ORDER BY id`,
  );
  const findings = await roQuery<{ id: string; status: string }>(
    graphName,
    `MATCH (f:Finding) RETURN f.findingId AS id, f.verificationStatus AS status ORDER BY id`,
  );
  const rels = await roQuery<{ t: string; c: number }>(
    graphName,
    `MATCH ()-[r]->() RETURN type(r) AS t, count(r) AS c ORDER BY t`,
  );
  return { counts: counts.data, runs: runs.data, findings: findings.data, rels: rels.data };
}

beforeAll(async () => {
  await seedEducationGraph(graphName);
  runA = await runAndPersistAnalysis(graphName, SCENARIO_ROOT_ENTITY_ID);
  runB = await runAndPersistAnalysis(graphName, SCENARIO_ROOT_ENTITY_ID);
}, 180_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("token primitives", () => {
  it("generates high-entropy, non-repeating tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateOwnerToken()));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes to a stable 64-char sha256 hex digest", () => {
    const t = generateOwnerToken();
    expect(hashOwnerToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOwnerToken(t)).toBe(hashOwnerToken(t));
    expect(hashOwnerToken(t)).not.toBe(hashOwnerToken(generateOwnerToken()));
  });

  it("compares hashes without throwing on length mismatch", () => {
    const a = hashOwnerToken("a");
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, hashOwnerToken("b"))).toBe(false);
    expect(hashesEqual(a, "short")).toBe(false);
  });
});

describe("Case 1 — correct run id + valid token permits mutation", () => {
  it("allows an authorized state change", async () => {
    const rows = await withRunAuthorization<{ status: string }>(
      graphName,
      { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
      `SET run.status = 'PENDING'`,
      `RETURN run.status AS status`,
    );
    expect(rows[0]?.status).toBe("PENDING");

    await withRunAuthorization(
      graphName,
      { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
      `SET run.status = 'COMPLETED'`,
      `RETURN run.status AS status`,
    );
    expect((await getRun(graphName, runA.run.analysisRunId))!.status).toBe("COMPLETED");
  });

  it("allows an authorized retry of persistence", async () => {
    const r = await retryPersistAnalysis(
      graphName,
      { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
      SCENARIO_ROOT_ENTITY_ID,
    );
    expect(r.persistAttempts).toBeGreaterThan(1);
  }, 120_000);
});

describe("Case 2 — correct run id + incorrect token is rejected", () => {
  it("rejects a wrong token and changes nothing", async () => {
    const before = await fullSnapshot();

    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runA.run.analysisRunId, ownerToken: generateOwnerToken() },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);

    expect(await fullSnapshot()).toEqual(before);
  });

  it("rejects a token that is a prefix of the real one", async () => {
    const before = await fullSnapshot();
    await expect(
      withRunAuthorization(
        graphName,
        {
          analysisRunId: runA.run.analysisRunId,
          ownerToken: runA.run.ownerToken.slice(0, -1),
        },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);
    expect(await fullSnapshot()).toEqual(before);
  });

  it("rejects the token's own hash used as if it were the token", async () => {
    // Guards against a design where the stored value is accepted directly.
    const before = await fullSnapshot();
    await expect(
      withRunAuthorization(
        graphName,
        {
          analysisRunId: runA.run.analysisRunId,
          ownerToken: hashOwnerToken(runA.run.ownerToken),
        },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);
    expect(await fullSnapshot()).toEqual(before);
  });
});

describe("Case 3 — correct run id with no token is rejected", () => {
  it.each([
    ["an empty token", ""],
    ["a whitespace token", "   "],
  ])("rejects %s", async (_label, token) => {
    const before = await fullSnapshot();
    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runA.run.analysisRunId, ownerToken: token },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);
    expect(await fullSnapshot()).toEqual(before);
  });

  it("rejects a missing token field", async () => {
    const before = await fullSnapshot();
    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runA.run.analysisRunId } as never,
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);
    expect(await fullSnapshot()).toEqual(before);
  });

  it("rejects entirely absent credentials", async () => {
    await expect(
      withRunAuthorization(
        graphName,
        undefined as never,
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);
  });
});

describe("Case 4 — Run A's token cannot mutate Run B", () => {
  it("rejects a cross-run credential and changes nothing", async () => {
    const before = await fullSnapshot();

    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runB.run.analysisRunId, ownerToken: runA.run.ownerToken },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);

    expect(await fullSnapshot()).toEqual(before);
  });

  it("rejects a cross-run retry without touching Run B's findings", async () => {
    const bBefore = await listFindings(graphName, runB.run.analysisRunId);
    const bRunBefore = await getRun(graphName, runB.run.analysisRunId);

    await expect(
      retryPersistAnalysis(
        graphName,
        { analysisRunId: runB.run.analysisRunId, ownerToken: runA.run.ownerToken },
        SCENARIO_ROOT_ENTITY_ID,
      ),
    ).rejects.toThrow(RunAuthorizationError);

    expect(await listFindings(graphName, runB.run.analysisRunId)).toEqual(bBefore);
    const bRunAfter = await getRun(graphName, runB.run.analysisRunId);
    expect(bRunAfter!.persistAttempts).toBe(bRunBefore!.persistAttempts);
    expect(bRunAfter!.updatedAt).toBe(bRunBefore!.updatedAt);
  }, 120_000);
});

describe("Case 5 — rejected mutations create no stray state", () => {
  it("creates no nodes, relationships, or runs for an unknown run id", async () => {
    const before = await fullSnapshot();

    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: "does-not-exist", ownerToken: generateOwnerToken() },
        `SET run.status = 'TAMPERED'`,
        `RETURN run.analysisRunId AS id`,
      ),
    ).rejects.toThrow(RunAuthorizationError);

    expect(await fullSnapshot()).toEqual(before);
    expect(await getRun(graphName, "does-not-exist")).toBeNull();
  });

  it("creates no Finding nodes when an unauthorized persist is attempted", async () => {
    const beforeCount = await roQuery<{ c: number }>(
      graphName,
      `MATCH (f:Finding) RETURN count(f) AS c`,
    );

    await expect(
      retryPersistAnalysis(
        graphName,
        { analysisRunId: runA.run.analysisRunId, ownerToken: "definitely-not-the-token" },
        SCENARIO_ROOT_ENTITY_ID,
      ),
    ).rejects.toThrow(RunAuthorizationError);

    const afterCount = await roQuery<{ c: number }>(
      graphName,
      `MATCH (f:Finding) RETURN count(f) AS c`,
    );
    expect(afterCount.data[0]!.c).toBe(beforeCount.data[0]!.c);
  }, 120_000);

  it("leaves organizational data untouched after all rejected attempts", async () => {
    expect(await census(graphName)).toEqual(expectedCensus());
  });
});

describe("reserved parameter names cannot be overridden", () => {
  it("refuses a caller-supplied runId parameter", async () => {
    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
        `SET run.status = 'COMPLETED'`,
        `RETURN run.analysisRunId AS id`,
        { runId: "spoofed" },
      ),
    ).rejects.toThrow(/reserved/i);
  });

  it("refuses a caller-supplied ownerTokenHash parameter", async () => {
    await expect(
      withRunAuthorization(
        graphName,
        { analysisRunId: runA.run.analysisRunId, ownerToken: runA.run.ownerToken },
        `SET run.status = 'COMPLETED'`,
        `RETURN run.analysisRunId AS id`,
        { ownerTokenHash: hashOwnerToken("anything") },
      ),
    ).rejects.toThrow(/reserved/i);
  });
});

describe("administrative pathway is explicitly separate", () => {
  it("refuses to run without explicit bypass acknowledgement", async () => {
    await expect(
      adminDeleteRun(graphName, runB.run.analysisRunId, {
        iUnderstandThisBypassesOwnership: false as never,
        reason: "x",
      }),
    ).rejects.toThrow(/acknowledgement/i);
  });

  it("refuses to run without a reason", async () => {
    await expect(
      adminDeleteRun(graphName, runB.run.analysisRunId, {
        iUnderstandThisBypassesOwnership: true,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/i);
  });

  it("deletes only the targeted run, leaving other runs and the seed intact", async () => {
    const aBefore = await listFindings(graphName, runA.run.analysisRunId);

    const res = await adminDeleteRun(graphName, runB.run.analysisRunId, {
      iUnderstandThisBypassesOwnership: true,
      reason: "integration test cleanup",
    });
    expect(res.deletedFindings).toBeGreaterThan(0);

    expect(await getRun(graphName, runB.run.analysisRunId)).toBeNull();
    expect(await listFindings(graphName, runB.run.analysisRunId)).toEqual([]);

    expect(await listFindings(graphName, runA.run.analysisRunId)).toEqual(aBefore);
    expect(await census(graphName)).toEqual(expectedCensus());
  }, 120_000);
});
