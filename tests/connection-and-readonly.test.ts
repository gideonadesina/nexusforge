/**
 * Integration tests for connectivity, graph-ownership safety, and read-only
 * enforcement (experiment E7). Real FalkorDB instance, no mocks.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  ping,
  listGraphs,
  roQuery,
  writeQuery,
  assertOwnedGraph,
  closeDb,
} from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";

const graphName = uniqueTestGraph("ro");

beforeAll(async () => {
  await writeQuery(
    graphName,
    `CREATE (:Entity {id: 'ro_a', type: 'T', name: 'A'}),
            (:Entity {id: 'ro_b', type: 'T', name: 'B'})`,
  );
}, 60_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("connection", () => {
  it("reaches the real FalkorDB instance", async () => {
    const result = await ping();
    expect(result.ok).toBe(true);
    expect(typeof result.graphs).toBe("number");
  });

  it("lists graphs without mutating them", async () => {
    const before = await listGraphs();
    const after = await listGraphs();
    expect(after.sort()).toEqual(before.sort());
  });

  it("never leaks the password in the connection summary", async () => {
    const { connectionSummary } = await import("../src/lib/falkor/client");
    const summary = connectionSummary();
    expect(summary).not.toContain(process.env.FALKORDB_PASSWORD ?? "@@unset@@");
    expect(summary).not.toContain(process.env.FALKORDB_HOST ?? "@@unset@@");
  });
});

describe("graph ownership guard", () => {
  it("accepts nf_-prefixed names", () => {
    expect(assertOwnedGraph("nf_demo_education")).toBe("nf_demo_education");
  });

  it("refuses any graph outside the nf_ namespace", () => {
    expect(() => assertOwnedGraph("someone_elses_graph")).toThrow(/may only touch graphs/);
    expect(() => assertOwnedGraph("")).toThrow(/may only touch graphs/);
  });

  it("blocks reads and writes to unowned graphs at the client boundary", async () => {
    await expect(roQuery("not_ours", `MATCH (n) RETURN n`)).rejects.toThrow(
      /may only touch graphs/,
    );
    await expect(writeQuery("not_ours", `CREATE (:X)`)).rejects.toThrow(
      /may only touch graphs/,
    );
  });
});

describe("E7 — GRAPH.RO_QUERY rejects writes", () => {
  const writeStatements: Array<[string, string]> = [
    ["CREATE", `CREATE (:Entity {id: 'ro_illegal_create'}) RETURN 1 AS x`],
    ["SET", `MATCH (n:Entity {id: 'ro_a'}) SET n.name = 'mutated' RETURN 1 AS x`],
    ["DELETE", `MATCH (n:Entity {id: 'ro_b'}) DELETE n`],
    ["MERGE", `MERGE (:Entity {id: 'ro_illegal_merge'}) RETURN 1 AS x`],
  ];

  it.each(writeStatements)("rejects a %s statement", async (_label, cypher) => {
    await expect(roQuery(graphName, cypher)).rejects.toThrow(/read-only/i);
  });

  it("left the graph completely unmutated", async () => {
    const count = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:Entity) RETURN count(n) AS c`,
    );
    expect(count.data[0]?.c).toBe(2);

    const names = await roQuery<{ id: string; name: string }>(
      graphName,
      `MATCH (n:Entity) RETURN n.id AS id, n.name AS name ORDER BY id`,
    );
    expect(names.data).toEqual([
      { id: "ro_a", name: "A" },
      { id: "ro_b", name: "B" },
    ]);

    const illegal = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:Entity) WHERE n.id STARTS WITH 'ro_illegal' RETURN count(n) AS c`,
    );
    expect(illegal.data[0]?.c).toBe(0);
  });

  it("still permits legitimate reads", async () => {
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:Entity) RETURN count(n) AS c`,
    );
    expect(res.data[0]?.c).toBe(2);
  });
});
