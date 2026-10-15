/**
 * Organization isolation (Priority 3).
 *
 * Deliberately hostile: both test organizations use the SAME entity ids,
 * source ids and dependency ids, differing only in content. If any lookup
 * leaked across the boundary, these tests would surface organization B's
 * content under organization A's identifiers.
 *
 * Real FalkorDB. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedGraph } from "../src/lib/graph/seed";
import { analyseImpact } from "../src/lib/engine/impact";
import { runAndPersistAnalysis } from "../src/lib/runs/analyse-and-persist";
import { getRun, listFindings } from "../src/lib/runs/persist";
import { proposeActions, listProposals, listAuditEvents, approveProposal } from "../src/lib/actions/actions";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { resolveOrg, UnknownOrganizationError, publicView, ORGANIZATIONS } from "../src/lib/org/registry";
import { orgContext } from "../src/lib/org/packs";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { DomainPack } from "../src/lib/graph/domain-pack";

/** Two packs with COLLIDING identifiers and different content. */
function collidingPack(tag: string): DomainPack {
  return {
    domain: `collide-${tag}`,
    seedVersion: `collide-${tag}-v1`,
    scenarioRootId: "shared_root",
    decoyEntityIds: [],
    sources: [
      {
        id: "shared_src",
        reference: `${tag} reference document`,
        excerpt: `This excerpt belongs to ${tag}.`,
        sourceType: "doc",
      },
    ],
    entities: [
      {
        id: "shared_root",
        type: "Root",
        name: `${tag} root`,
        intermediary: false,
        sourceIds: ["shared_src"],
      },
      {
        id: "shared_child",
        type: "Child",
        name: `${tag} child`,
        intermediary: false,
        sourceIds: ["shared_src"],
      },
      {
        // Present in BOTH, so a leak would be invisible without content checks.
        id: `only_in_${tag}`,
        type: "Unique",
        name: `${tag} exclusive entity`,
        intermediary: false,
        sourceIds: ["shared_src"],
      },
    ],
    dependencies: [
      {
        id: "shared_dep",
        from: "shared_child",
        to: "shared_root",
        kind: "depends",
        sourceId: "shared_src",
      },
      {
        id: `dep_only_in_${tag}`,
        from: `only_in_${tag}`,
        to: "shared_root",
        kind: "depends",
        sourceId: "shared_src",
      },
    ],
  };
}

const graphA = uniqueTestGraph("orgiso_a");
const graphB = uniqueTestGraph("orgiso_b");
const packA = collidingPack("alpha");
const packB = collidingPack("beta");

beforeAll(async () => {
  await seedGraph(graphA, packA);
  await seedGraph(graphB, packB);
}, 240_000);

afterAll(async () => {
  await cleanupGraph(graphA);
  await cleanupGraph(graphB);
  await closeDb();
});

describe("registry is an allowlist, not a pass-through", () => {
  it("resolves known ids", () => {
    expect(resolveOrg("northstar").graphName).toBe("nf_demo_northstar");
    expect(resolveOrg("education").graphName).toBe("nf_demo_education");
  });

  it("defaults only when nothing was supplied", () => {
    expect(resolveOrg(undefined).id).toBe("northstar");
    expect(resolveOrg("").id).toBe("northstar");
  });

  it.each([
    ["an unknown id", "acme"],
    ["a raw graph name", "nf_demo_education"],
    ["an injection attempt", "northstar; MATCH (n) DETACH DELETE n"],
    ["a traversal attempt", "../education"],
    ["a number", 42],
    ["an object", { id: "northstar" }],
    ["null", null],
    ["a boolean", true],
  ])("fails closed for %s", (_label, value) => {
    // null means "not supplied" only for undefined/empty string; anything
    // else must be rejected rather than silently defaulted.
    if (value === null) {
      expect(resolveOrg(value).id).toBe("northstar");
      return;
    }
    expect(() => resolveOrg(value)).toThrow(UnknownOrganizationError);
  });

  it("never lets the browser choose a graph name", () => {
    // The only graph names in existence come from the registry table.
    for (const org of Object.values(ORGANIZATIONS)) {
      expect(org.graphName).toMatch(/^nf_/);
    }
    // And the public view does not carry one.
    const pub = publicView(resolveOrg("northstar")) as unknown as Record<string, unknown>;
    expect(pub.graphName).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain("nf_demo");
  });

  it("pairs every organization with its own pack", () => {
    expect(orgContext("northstar").pack.domain).toBe("technology-operations");
    expect(orgContext("education").pack.domain).toBe("education");
    expect(orgContext("northstar").graphName).not.toBe(orgContext("education").graphName);
  });
});

describe("colliding identifiers never cross the boundary", () => {
  it("returns each organization's own content for the same entity id", async () => {
    const a = await roQuery<{ name: string }>(
      graphA,
      `MATCH (e:Entity {id:'shared_root'}) RETURN e.name AS name`,
    );
    const b = await roQuery<{ name: string }>(
      graphB,
      `MATCH (e:Entity {id:'shared_root'}) RETURN e.name AS name`,
    );
    expect(a.data[0]?.name).toBe("alpha root");
    expect(b.data[0]?.name).toBe("beta root");
  });

  it("returns each organization's own evidence for the same source id", async () => {
    const a = await roQuery<{ excerpt: string }>(
      graphA,
      `MATCH (s:Source {id:'shared_src'}) RETURN s.excerpt AS excerpt`,
    );
    const b = await roQuery<{ excerpt: string }>(
      graphB,
      `MATCH (s:Source {id:'shared_src'}) RETURN s.excerpt AS excerpt`,
    );
    expect(a.data[0]?.excerpt).toContain("alpha");
    expect(b.data[0]?.excerpt).toContain("beta");
    expect(a.data[0]?.excerpt).not.toContain("beta");
  });

  it("an analysis in A never mentions B's exclusive entity", async () => {
    const analysis = await analyseImpact(graphA, "shared_root");
    const ids = analysis.impacted.map((e) => e.entityId);
    expect(ids).toContain("only_in_alpha");
    expect(ids).not.toContain("only_in_beta");

    for (const e of analysis.impacted) {
      expect(e.name).not.toContain("beta");
      for (const ev of e.evidence) expect(ev.excerpt).not.toContain("beta");
    }
  }, 60_000);

  it("and the reverse holds for B", async () => {
    const analysis = await analyseImpact(graphB, "shared_root");
    const ids = analysis.impacted.map((e) => e.entityId);
    expect(ids).toContain("only_in_beta");
    expect(ids).not.toContain("only_in_alpha");
    for (const e of analysis.impacted) expect(e.name).not.toContain("alpha");
  }, 60_000);
});

describe("runs, findings, proposals and audit are organization-scoped", () => {
  it("a run created in A is invisible in B, even knowing its id", async () => {
    const runA = await runAndPersistAnalysis(graphA, "shared_root");

    // Same id, other organization.
    expect(await getRun(graphB, runA.run.analysisRunId)).toBeNull();
    expect(await listFindings(graphB, runA.run.analysisRunId)).toEqual([]);

    // Present in its own organization.
    expect(await getRun(graphA, runA.run.analysisRunId)).not.toBeNull();
    expect((await listFindings(graphA, runA.run.analysisRunId)).length).toBeGreaterThan(0);
  }, 120_000);

  it("proposals and audit events do not leak across organizations", async () => {
    const runA = await runAndPersistAnalysis(graphA, "shared_root");
    const creds = {
      analysisRunId: runA.run.analysisRunId,
      ownerToken: runA.run.ownerToken,
    };
    await proposeActions(graphA, creds, runA.analysis);

    const proposalsA = await listProposals(graphA, runA.run.analysisRunId);
    expect(proposalsA.length).toBeGreaterThan(0);
    expect(await listProposals(graphB, runA.run.analysisRunId)).toEqual([]);

    await approveProposal(graphA, creds, proposalsA[0]!.proposalId, "isolation test");
    expect((await listAuditEvents(graphA, runA.run.analysisRunId)).length).toBe(1);
    expect(await listAuditEvents(graphB, runA.run.analysisRunId)).toEqual([]);
  }, 180_000);

  it("a valid token from A cannot decide a proposal through B's graph", async () => {
    const runA = await runAndPersistAnalysis(graphA, "shared_root");
    const creds = {
      analysisRunId: runA.run.analysisRunId,
      ownerToken: runA.run.ownerToken,
    };
    await proposeActions(graphA, creds, runA.analysis);
    const proposal = (await listProposals(graphA, runA.run.analysisRunId))[0]!;

    // Correct run id, correct token, WRONG organization: the run does not
    // exist in B, so the authorization MATCH binds nothing.
    await expect(approveProposal(graphB, creds, proposal.proposalId)).rejects.toThrow();

    // And nothing was written into B.
    const strays = await roQuery<{ c: number }>(
      graphB,
      `MATCH (n) WHERE n:AnalysisRun OR n:ActionProposal OR n:AuditEvent RETURN count(n) AS c`,
    );
    expect(strays.data[0]?.c).toBe(0);
  }, 180_000);

  it("B's organizational data is untouched by all of A's activity", async () => {
    const census = await roQuery<{ e: number; s: number }>(
      graphB,
      `MATCH (e:Entity) WITH count(e) AS e MATCH (s:Source) RETURN e, count(s) AS s`,
    );
    expect(census.data[0]?.e).toBe(packB.entities.length);
    expect(census.data[0]?.s).toBe(packB.sources.length);
  });
});
