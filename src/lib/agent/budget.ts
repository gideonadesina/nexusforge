import { writeQuery, roQuery } from "../falkor/client";
import { getEnv } from "../env";

/**
 * Cumulative usage budget, enforced ACROSS serverless instances.
 *
 * A process-local counter is useless on Vercel: every cold start gets a fresh
 * one, so N instances means N times the budget. The ledger therefore lives in
 * FalkorDB -- already our only datastore -- and is incremented inside a single
 * Cypher statement, which FalkorDB executes atomically. Two concurrent
 * requests cannot both pass a check that only one of them should.
 *
 * The reservation is taken BEFORE the model call, using an estimate, and
 * reconciled afterwards with real usage. Reserving first means a burst of
 * concurrent requests cannot collectively overshoot while all waiting on
 * their own responses.
 */

export const BUDGET_NODE_ID = "agent_budget_global";

export interface BudgetLimits {
  /** Hard cap on tokens per rolling window. */
  maxTokens: number;
  /** Hard cap on model requests per rolling window. */
  maxRequests: number;
  /** Rolling window length. */
  windowMs: number;
}

export function budgetLimits(): BudgetLimits {
  return {
    maxTokens: Number(process.env.NF_AGENT_MAX_TOKENS ?? 200_000),
    maxRequests: Number(process.env.NF_AGENT_MAX_REQUESTS ?? 200),
    windowMs: Number(process.env.NF_AGENT_WINDOW_MS ?? 24 * 60 * 60 * 1000),
  };
}

export class BudgetExceededError extends Error {
  constructor(what: string, used: number, limit: number) {
    super(
      `Agent budget exceeded: ${what} ${used}/${limit} in the current window. ` +
        `AI features are paused; deterministic analysis is unaffected.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface BudgetSnapshot {
  tokensUsed: number;
  requestsUsed: number;
  windowStart: number;
  maxTokens: number;
  maxRequests: number;
}

/**
 * Atomically roll the window if stale, charge an estimate, and report the
 * resulting totals. One statement, so no check-then-write race.
 */
export async function reserve(estimatedTokens: number): Promise<BudgetSnapshot> {
  const graphName = getEnv().FALKORDB_GRAPH;
  const limits = budgetLimits();
  const now = Date.now();

  const res = await writeQuery<{
    tokensUsed: number;
    requestsUsed: number;
    windowStart: number;
  }>(
    graphName,
    `
MERGE (b:AgentBudget {id: $id})
SET b.windowStart  = CASE
                       WHEN b.windowStart IS NULL OR $now - b.windowStart > $windowMs
                       THEN $now ELSE b.windowStart END,
    b.tokensUsed   = CASE
                       WHEN b.windowStart = $now THEN 0
                       ELSE coalesce(b.tokensUsed, 0) END,
    b.requestsUsed = CASE
                       WHEN b.windowStart = $now THEN 0
                       ELSE coalesce(b.requestsUsed, 0) END
SET b.tokensUsed   = b.tokensUsed + $estimate,
    b.requestsUsed = b.requestsUsed + 1
RETURN b.tokensUsed AS tokensUsed, b.requestsUsed AS requestsUsed,
       b.windowStart AS windowStart
`.trim(),
    { params: { id: BUDGET_NODE_ID, now, windowMs: limits.windowMs, estimate: estimatedTokens } },
  );

  const row = res.data[0];
  const snapshot: BudgetSnapshot = {
    tokensUsed: row?.tokensUsed ?? 0,
    requestsUsed: row?.requestsUsed ?? 0,
    windowStart: row?.windowStart ?? now,
    maxTokens: limits.maxTokens,
    maxRequests: limits.maxRequests,
  };

  if (snapshot.requestsUsed > limits.maxRequests) {
    throw new BudgetExceededError("requests", snapshot.requestsUsed, limits.maxRequests);
  }
  if (snapshot.tokensUsed > limits.maxTokens) {
    throw new BudgetExceededError("tokens", snapshot.tokensUsed, limits.maxTokens);
  }
  return snapshot;
}

/** Replace the estimate with the provider's reported usage. */
export async function reconcile(estimatedTokens: number, actualTokens: number): Promise<void> {
  const delta = actualTokens - estimatedTokens;
  if (delta === 0) return;
  const graphName = getEnv().FALKORDB_GRAPH;
  await writeQuery(
    graphName,
    `MATCH (b:AgentBudget {id: $id})
     SET b.tokensUsed = CASE WHEN coalesce(b.tokensUsed,0) + $delta < 0
                             THEN 0 ELSE coalesce(b.tokensUsed,0) + $delta END`,
    { params: { id: BUDGET_NODE_ID, delta } },
  );
}

export async function budgetSnapshot(): Promise<BudgetSnapshot> {
  const graphName = getEnv().FALKORDB_GRAPH;
  const limits = budgetLimits();
  const res = await roQuery<{
    tokensUsed: number;
    requestsUsed: number;
    windowStart: number;
  }>(
    graphName,
    `MATCH (b:AgentBudget {id: $id})
     RETURN coalesce(b.tokensUsed,0) AS tokensUsed,
            coalesce(b.requestsUsed,0) AS requestsUsed,
            coalesce(b.windowStart,0) AS windowStart`,
    { params: { id: BUDGET_NODE_ID } },
  );
  const row = res.data[0];
  return {
    tokensUsed: row?.tokensUsed ?? 0,
    requestsUsed: row?.requestsUsed ?? 0,
    windowStart: row?.windowStart ?? 0,
    maxTokens: limits.maxTokens,
    maxRequests: limits.maxRequests,
  };
}

/** Reset the window. Operator maintenance only; not reachable from a request. */
export async function resetBudget(): Promise<void> {
  const graphName = getEnv().FALKORDB_GRAPH;
  await writeQuery(
    graphName,
    `MERGE (b:AgentBudget {id: $id})
     SET b.tokensUsed = 0, b.requestsUsed = 0, b.windowStart = $now`,
    { params: { id: BUDGET_NODE_ID, now: Date.now() } },
  );
}
