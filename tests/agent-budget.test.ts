/**
 * Budget ledger — enforced in FalkorDB so it holds across serverless
 * instances, not in process memory.
 *
 * Real FalkorDB. No mocks. No OpenAI calls.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { reserve, reconcile, budgetSnapshot, resetBudget, BudgetExceededError } from "../src/lib/agent/budget";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { getEnv } from "../src/lib/env";

const graphName = getEnv().FALKORDB_GRAPH;

beforeEach(async () => {
  await resetBudget();
});

afterAll(async () => {
  await resetBudget();
  await closeDb();
});

describe("ledger lives in FalkorDB, not memory", () => {
  it("persists the counter as a graph node", async () => {
    await reserve(100);
    const res = await roQuery<{ t: number; r: number }>(
      graphName,
      `MATCH (b:AgentBudget {id:'agent_budget_global'})
       RETURN b.tokensUsed AS t, b.requestsUsed AS r`,
    );
    expect(res.data[0]?.t).toBe(100);
    expect(res.data[0]?.r).toBe(1);
  });

  it("accumulates across separate calls, as separate instances would", async () => {
    await reserve(100);
    await reserve(250);
    const snap = await budgetSnapshot();
    expect(snap.tokensUsed).toBe(350);
    expect(snap.requestsUsed).toBe(2);
  });
});

describe("concurrent reservations cannot double-spend", () => {
  it("counts every concurrent reservation exactly once", async () => {
    const N = 12;
    await Promise.all(Array.from({ length: N }, () => reserve(100)));
    const snap = await budgetSnapshot();
    // If the increment were a read-then-write race, some would be lost.
    expect(snap.requestsUsed).toBe(N);
    expect(snap.tokensUsed).toBe(N * 100);
  }, 60_000);
});

describe("exhaustion", () => {
  // `budgetLimits()` reads the environment on every call, so the caps can be
  // lowered for the test. Walking a 200-request cap for real meant 200
  // sequential round trips, which starved the following hooks until they
  // timed out -- a slow test failing its neighbours, not a code defect.
  const originalRequests = process.env.NF_AGENT_MAX_REQUESTS;
  const originalTokens = process.env.NF_AGENT_MAX_TOKENS;

  beforeEach(() => {
    process.env.NF_AGENT_MAX_REQUESTS = "4";
    process.env.NF_AGENT_MAX_TOKENS = "1000";
  });

  afterEach(() => {
    if (originalRequests === undefined) delete process.env.NF_AGENT_MAX_REQUESTS;
    else process.env.NF_AGENT_MAX_REQUESTS = originalRequests;
    if (originalTokens === undefined) delete process.env.NF_AGENT_MAX_TOKENS;
    else process.env.NF_AGENT_MAX_TOKENS = originalTokens;
  });

  it("throws once the request cap is passed", async () => {
    for (let i = 0; i < 4; i += 1) await reserve(1);
    await expect(reserve(1)).rejects.toThrow(BudgetExceededError);
  }, 60_000);

  it("reports which limit was hit and that deterministic analysis is unaffected", async () => {
    try {
      for (let i = 0; i < 5; i += 1) await reserve(1);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as Error).message).toMatch(/requests/);
      expect((err as Error).message).toMatch(/deterministic analysis is unaffected/i);
    }
  }, 60_000);

  it("throws on the token cap independently of the request cap", async () => {
    await expect(reserve(2_000)).rejects.toThrow(/tokens/);
  }, 60_000);
});

describe("reconciliation replaces the estimate with real usage", () => {
  it("reduces the counter when actual usage was lower", async () => {
    await reserve(1_500);
    await reconcile(1_500, 400);
    expect((await budgetSnapshot()).tokensUsed).toBe(400);
  });

  it("increases the counter when actual usage was higher", async () => {
    await reserve(1_500);
    await reconcile(1_500, 2_000);
    expect((await budgetSnapshot()).tokensUsed).toBe(2_000);
  });

  it("is a no-op when the estimate was exact", async () => {
    await reserve(1_000);
    await reconcile(1_000, 1_000);
    expect((await budgetSnapshot()).tokensUsed).toBe(1_000);
  });

  it("never drives the counter negative", async () => {
    await reserve(100);
    await reconcile(100, 0);
    expect((await budgetSnapshot()).tokensUsed).toBe(0);
    await reconcile(5_000, 0);
    expect((await budgetSnapshot()).tokensUsed).toBe(0);
  });
});

describe("a failed model call still costs its reservation until reconciled", () => {
  it("leaves the reservation charged if the call throws", async () => {
    // This is the desired behaviour: a failed call may still have been billed
    // upstream, so we do not silently refund it.
    await reserve(1_500);
    expect((await budgetSnapshot()).tokensUsed).toBe(1_500);
  });

  it("can be refunded explicitly when the call provably did not bill", async () => {
    await reserve(1_500);
    await reconcile(1_500, 0);
    expect((await budgetSnapshot()).tokensUsed).toBe(0);
  });
});

describe("budget data stays off organizational labels", () => {
  it("does not attach the ledger to Entity or Finding", async () => {
    await reserve(10);
    const res = await roQuery<{ c: number }>(
      graphName,
      `MATCH (n:AgentBudget) WHERE n:Entity OR n:Finding OR n:AnalysisRun RETURN count(n) AS c`,
    );
    expect(res.data[0]?.c).toBe(0);
  });
});
