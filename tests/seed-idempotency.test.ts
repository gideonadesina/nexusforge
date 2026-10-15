/**
 * Golden integration test — Test 5 (seed idempotency).
 *
 * Runs the real seed twice against a real FalkorDB graph and proves the second
 * run creates no duplicate logical records.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedEducationGraph, census, expectedCensus, isSeeded, ensureSeeded } from "../src/lib/graph/seed";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { ENTITY_ID_CENSUS, DEPENDENCY_ID_CENSUS } from "../src/lib/graph/queries";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { GraphCensus } from "../src/lib/graph/seed";

const graphName = uniqueTestGraph("idempotency");

let first: GraphCensus;
let second: GraphCensus;

beforeAll(async () => {
  const r1 = await seedEducationGraph(graphName);
  first = r1.census;
  const r2 = await seedEducationGraph(graphName);
  second = r2.census;
}, 120_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("Test 5 — seed idempotency", () => {
  it("first run matches the domain pack exactly", () => {
    expect(first).toEqual(expectedCensus());
  });

  it("second run produces identical node and relationship counts", () => {
    expect(second).toEqual(first);
  });

  it("creates no duplicate Entity ids", async () => {
    const res = await roQuery<{ id: string; occurrences: number }>(graphName, ENTITY_ID_CENSUS);
    expect(res.data.length).toBeGreaterThan(0);
    const dupes = res.data.filter((r) => r.occurrences !== 1);
    expect(dupes, `duplicated entity ids: ${JSON.stringify(dupes)}`).toEqual([]);
  });

  it("creates no duplicate DEPENDS_ON edge ids", async () => {
    const res = await roQuery<{ id: string; occurrences: number }>(
      graphName,
      DEPENDENCY_ID_CENSUS,
    );
    expect(res.data.length).toBeGreaterThan(0);
    const dupes = res.data.filter((r) => r.occurrences !== 1);
    expect(dupes, `duplicated dependency ids: ${JSON.stringify(dupes)}`).toEqual([]);
  });

  it("creates no duplicate EVIDENCED_BY edges between the same pair", async () => {
    const res = await roQuery<{ pair: string; occurrences: number }>(
      graphName,
      `MATCH (e:Entity)-[r:EVIDENCED_BY]->(s:Source)
       RETURN e.id + '>' + s.id AS pair, count(r) AS occurrences
       ORDER BY pair`,
    );
    const dupes = res.data.filter((r) => r.occurrences !== 1);
    expect(dupes, `duplicated evidence edges: ${JSON.stringify(dupes)}`).toEqual([]);
  });

  it("remains stable after a third run", async () => {
    await seedEducationGraph(graphName);
    expect(await census(graphName)).toEqual(first);
  }, 60_000);

  it("reports the graph as seeded, and ensureSeeded becomes a no-op", async () => {
    expect(await isSeeded(graphName)).toBe(true);
    const r = await ensureSeeded(graphName);
    expect(r.alreadySeeded).toBe(true);
    expect(r.report).toBeNull();
  });
});

describe("re-seed pathway for a missing graph", () => {
  const missing = uniqueTestGraph("reseed");

  afterAll(async () => {
    await cleanupGraph(missing);
  });

  it("reports an absent graph as not seeded, then rebuilds it", async () => {
    // A graph that has never been written does not exist on the server.
    expect(await isSeeded(missing)).toBe(false);

    const r = await ensureSeeded(missing);
    expect(r.alreadySeeded).toBe(false);
    expect(r.report).not.toBeNull();
    expect(r.report!.census).toEqual(expectedCensus());
    expect(await isSeeded(missing)).toBe(true);
  }, 120_000);
});
