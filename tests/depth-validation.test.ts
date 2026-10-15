/**
 * Stage 2A — traversal-depth validation (requirement 12).
 *
 * UNIT TESTS. These deliberately mock the FalkorDB client so we can prove a
 * negative: that NO graph query is issued when depth is invalid. They are not
 * integration tests and are not evidence of graph behaviour.
 *
 * The companion assertion against a real database lives in
 * tests/impact.test.ts ("rejects an out-of-range depth").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client BEFORE importing anything that uses it.
const roQuery = vi.fn();
const writeQuery = vi.fn();
vi.mock("../src/lib/falkor/client", () => ({
  roQuery,
  writeQuery,
  closeDb: vi.fn(),
  dropGraph: vi.fn(),
}));

const { parseDepth, assertDepth, InvalidDepthError, DEFAULT_TRAVERSAL_DEPTH, MAX_TRAVERSAL_DEPTH } =
  await import("../src/lib/graph/depth");
const { impactQuery, recheckDistinctCountQuery } = await import("../src/lib/graph/queries");
const { analyseImpact } = await import("../src/lib/engine/impact");

beforeEach(() => {
  roQuery.mockReset();
  writeQuery.mockReset();
});

describe("parseDepth accepts only finite integers in range", () => {
  it.each([1, 2, 3, 6, 8])("accepts %i", (d) => {
    expect(parseDepth(d)).toBe(d);
  });

  it("applies the documented default only when depth is absent", () => {
    expect(parseDepth(undefined)).toBe(DEFAULT_TRAVERSAL_DEPTH);
  });

  it("does NOT default a null value", () => {
    expect(() => parseDepth(null)).toThrow(InvalidDepthError);
  });
});

describe("parseDepth rejects every disallowed input", () => {
  const rejected: Array<[string, unknown]> = [
    ["fractional 2.5", 2.5],
    ["fractional 0.1", 0.1],
    ["negative -1", -1],
    ["zero", 0],
    ["out of range 9", 9],
    ["out of range 100", 100],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["string '3'", "3"],
    ["string '6'", "6"],
    ["injection string '3 OR 1=1'", "3 OR 1=1"],
    ["injection string '2; MATCH (n) DETACH DELETE n'", "2; MATCH (n) DETACH DELETE n"],
    ["injection string '1..99'", "1..99"],
    ["boolean true", true],
    ["null", null],
    ["object", { depth: 3 }],
    ["array", [3]],
    ["bigint", BigInt(3)],
  ];

  it.each(rejected)("rejects %s", (_label, value) => {
    expect(() => parseDepth(value)).toThrow(InvalidDepthError);
  });

  it("does not coerce numeric strings", () => {
    // The critical property: no string ever becomes a number, which is what
    // makes injection via depth structurally impossible.
    expect(() => parseDepth("3")).toThrow(InvalidDepthError);
  });

  it("never echoes an attacker-supplied string into the error message", () => {
    const payload = "2; MATCH (n) DETACH DELETE n";
    try {
      parseDepth(payload);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(payload);
      expect((err as Error).message).toContain("string");
    }
  });

  it("assertDepth is the same validator", () => {
    expect(() => assertDepth("3")).toThrow(InvalidDepthError);
    expect(assertDepth(4)).toBe(4);
  });
});

describe("query builders refuse to construct Cypher for invalid depth", () => {
  it.each([2.5, -1, 0, 9, Number.NaN, Number.POSITIVE_INFINITY])(
    "impactQuery rejects %s before building a string",
    (d) => {
      expect(() => impactQuery(d as number)).toThrow(InvalidDepthError);
    },
  );

  it("impactQuery rejects string input", () => {
    expect(() => impactQuery("3" as unknown as number)).toThrow(InvalidDepthError);
  });

  it("recheckDistinctCountQuery rejects invalid depth", () => {
    expect(() => recheckDistinctCountQuery(99)).toThrow(InvalidDepthError);
  });

  it("only ever interpolates a validated integer", () => {
    const q = impactQuery(5);
    expect(q).toContain("*1..5");
    // No parameter placeholder and no stray text in the bound.
    expect(q).not.toMatch(/\*1\.\.\$/);
    expect(q).toContain("$rootId"); // the root IS parameterized
  });

  it("caps at the hard maximum", () => {
    expect(() => impactQuery(MAX_TRAVERSAL_DEPTH)).not.toThrow();
    expect(() => impactQuery(MAX_TRAVERSAL_DEPTH + 1)).toThrow(InvalidDepthError);
  });
});

describe("no graph query is invoked for invalid depth", () => {
  const invalid: Array<[string, unknown]> = [
    ["2.5", 2.5],
    ["-1", -1],
    ["0", 0],
    ["9", 9],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["'3'", "3"],
    ["'3 OR 1=1'", "3 OR 1=1"],
    ["'2; MATCH ...'", "2; MATCH (n) DETACH DELETE n"],
  ];

  it.each(invalid)("analyseImpact with depth %s issues zero queries", async (_l, depth) => {
    await expect(
      analyseImpact("nf_test_never_touched", "some_entity", {
        maxDepth: depth as number,
      }),
    ).rejects.toThrow(InvalidDepthError);

    expect(roQuery).not.toHaveBeenCalled();
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it("a VALID depth does reach the client (proving the spy works)", async () => {
    roQuery.mockResolvedValue({ data: [], metadata: [] });
    // Root lookup returns nothing, so this throws a different, later error.
    await expect(
      analyseImpact("nf_test_graph", "some_entity", { maxDepth: 3 }),
    ).rejects.toThrow(/not found/i);

    expect(roQuery).toHaveBeenCalled();
  });
});
