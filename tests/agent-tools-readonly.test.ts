/**
 * FIX 1 regression — agent tools must never write.
 *
 * The defect: both read tools called `ensureSeeded(ctx.graphName)` with no
 * domain pack, so the EDUCATION pack was used. Against a correctly seeded
 * Northstar graph the education version check fails, and merely *reading*
 * through the agent would have seeded education data into Northstar.
 *
 * Real FalkorDB. No mocks, no OpenAI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { seedGraph, EDUCATION_PACK } from "../src/lib/graph/seed";
import { NORTHSTAR_PACK } from "../src/lib/org/packs";
import { TOOLS, getTool } from "../src/lib/agent/tools";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";

const nsGraph = uniqueTestGraph("toolsafety_ns");

interface Census {
  entities: number;
  sources: number;
  marker: string | undefined;
}

async function census(graph: string): Promise<Census> {
  const e = await roQuery<{ c: number }>(graph, `MATCH (n:Entity) RETURN count(n) AS c`);
  const s = await roQuery<{ c: number }>(graph, `MATCH (n:Source) RETURN count(n) AS c`);
  const m = await roQuery<{ v: string }>(
    graph,
    `MATCH (m:SeedMarker {id:'seed_marker'}) RETURN m.seedVersion AS v`,
  );
  return { entities: e.data[0]?.c ?? 0, sources: s.data[0]?.c ?? 0, marker: m.data[0]?.v };
}

beforeAll(async () => {
  await seedGraph(nsGraph, NORTHSTAR_PACK);
}, 180_000);

afterAll(async () => {
  await cleanupGraph(nsGraph);
  await closeDb();
});

describe("no tool declares itself a writer", () => {
  it("every tool is marked read-only", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const t of TOOLS) {
      expect(t.mutates, `${t.name} must be read-only`).toBe(false);
    }
  });

  it("the tool module imports no write capability", () => {
    const src = readFileSync("src/lib/agent/tools.ts", "utf8");
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+"[^"]+";$/gm)].map((m) => m[0]).join("\n");
    expect(imports).not.toMatch(/\bwriteQuery\b/);
    expect(imports).not.toMatch(/\bdropGraph\b/);
    // The seeding entry points are write paths and must not be reachable.
    expect(imports).not.toMatch(/\bensureSeeded\b/);
    expect(imports).not.toMatch(/\bseedGraph\b/);
    expect(imports).not.toMatch(/\bseedEducationGraph\b/);
    expect(src).not.toMatch(/await import\(/);
  });
});

describe("running every tool against Northstar changes nothing", () => {
  it("leaves the graph byte-identical and never education-seeded", async () => {
    const before = await census(nsGraph);
    expect(before.marker).toBe(NORTHSTAR_PACK.seedVersion);
    expect(before.entities).toBe(NORTHSTAR_PACK.entities.length);

    const ctx = { graphName: nsGraph };
    // Exercise each tool with arguments valid for the Northstar fixture.
    await getTool("list_entities")!.run({ minDependents: 0 }, ctx);
    await getTool("analyse_impact")!.run(
      { rootEntityId: NORTHSTAR_PACK.scenarioRootId, maxDepth: 6 },
      ctx,
    );
    await getTool("explain_path")!.run(
      {
        rootEntityId: NORTHSTAR_PACK.scenarioRootId,
        entityId: "ns_commitment_meridian",
        maxDepth: 6,
      },
      ctx,
    );
    await getTool("get_evidence")!.run(
      { rootEntityId: NORTHSTAR_PACK.scenarioRootId, entityId: "ns_commitment_meridian" },
      ctx,
    );
    await getTool("list_proposals")!.run({ analysisRunId: "no-such-run" }, ctx);

    const after = await census(nsGraph);
    expect(after).toEqual(before);
  }, 180_000);

  it("introduced no education records", async () => {
    // The exact contamination the audit predicted.
    const edu = await roQuery<{ c: number }>(
      nsGraph,
      `MATCH (n) WHERE n.id IN ['ent_person_okonkwo','src_resignation_okonkwo_2026_10_12']
       RETURN count(n) AS c`,
    );
    expect(edu.data[0]?.c).toBe(0);

    const foreign = await roQuery<{ c: number }>(
      nsGraph,
      `MATCH (e:Entity) WHERE e.domain <> $d RETURN count(e) AS c`,
      { params: { d: NORTHSTAR_PACK.domain } },
    );
    expect(foreign.data[0]?.c).toBe(0);
  });

  it("left the seed marker on the Northstar version", async () => {
    const m = await roQuery<{ v: string }>(
      nsGraph,
      `MATCH (m:SeedMarker {id:'seed_marker'}) RETURN m.seedVersion AS v`,
    );
    expect(m.data[0]?.v).toBe("northstar-v1");
    expect(m.data[0]?.v).not.toBe(EDUCATION_PACK.seedVersion);
  });
});

describe("initialization requires an explicit domain pack", () => {
  it("Northstar initialization never uses the education pack", async () => {
    // orgContext is the only way a route obtains a graph, and it always
    // supplies the matching pack.
    const { orgContext } = await import("../src/lib/org/packs");
    const ns = orgContext("northstar");
    expect(ns.pack.seedVersion).toBe("northstar-v1");
    expect(ns.pack.domain).toBe("technology-operations");
    expect(ns.pack).not.toBe(EDUCATION_PACK);
    expect(ns.pack.entities.some((e) => e.id === "ent_person_okonkwo")).toBe(false);

    const edu = orgContext("education");
    expect(edu.pack.seedVersion).toBe("edu-v1");
    expect(edu.graphName).not.toBe(ns.graphName);
  });

  it("the pack argument is required, so forgetting it cannot compile", () => {
    // A default pack is what allowed the contamination: a caller that forgot
    // to pass one silently seeded education data. The signature now demands
    // it, which this test documents alongside the type system.
    const src = readFileSync("src/lib/graph/seed.ts", "utf8");
    expect(src).toMatch(/export async function seedGraph\(graphName: string, pack: DomainPack\)/);
    expect(src).toMatch(/export async function isSeeded\(graphName: string, pack: DomainPack\)/);
    expect(src).toMatch(/export async function ensureSeeded\(\s*graphName: string,\s*pack: DomainPack,/);

    // Scoped deliberately to the three WRITE paths. `expectedCensus` keeps a
    // default because it only counts array lengths in memory — it touches no
    // graph and so cannot contaminate one.
    for (const fn of ["seedGraph", "isSeeded", "ensureSeeded"]) {
      const sig = new RegExp(`function ${fn}\\([^)]*pack: DomainPack = `, "s");
      expect(src, `${fn} must not default its pack`).not.toMatch(sig);
    }
  });
});

describe("the agent is disabled by default", () => {
  it("requires an explicit opt-in, independent of the LLM flag", async () => {
    const { agentEnabled } = await import("../src/lib/agent/loop");
    const original = process.env.NF_AGENT_ENABLED;
    try {
      delete process.env.NF_AGENT_ENABLED;
      expect(agentEnabled()).toBe(false);

      process.env.NF_AGENT_ENABLED = "false";
      expect(agentEnabled()).toBe(false);

      process.env.NF_AGENT_ENABLED = "true";
      expect(agentEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.NF_AGENT_ENABLED;
      else process.env.NF_AGENT_ENABLED = original;
    }
  });
});
