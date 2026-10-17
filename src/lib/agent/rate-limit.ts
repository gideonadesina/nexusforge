import { createHash } from "node:crypto";
import { writeQuery, roQuery } from "../falkor/client";
import { getEnv } from "../env";

/**
 * Per-visitor rate limiting, enforced server side and shared across instances.
 *
 * The global budget alone is not enough to expose paid inference publicly: it
 * caps total spend, but one visitor could still consume the entire daily
 * allowance and deny every judge behind them. This adds a second, per-caller
 * limit.
 *
 * Like the global budget, the counter lives in FalkorDB and is incremented
 * inside a single atomic statement. A process-local map would reset on every
 * cold start, which on serverless means no limit at all.
 *
 * The caller is identified by a SHA-256 of the client IP plus a daily salt.
 * We never store a raw IP: the hash is sufficient to count requests and
 * cannot be reversed into an address after the window rolls.
 */

export interface VisitorLimits {
  maxRequests: number;
  windowMs: number;
}

export function visitorLimits(): VisitorLimits {
  return {
    maxRequests: Number(process.env.NF_AGENT_VISITOR_MAX_REQUESTS ?? 5),
    windowMs: Number(process.env.NF_AGENT_VISITOR_WINDOW_MS ?? 60 * 60 * 1000),
  };
}

export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(used: number, limit: number, retryAfterSeconds: number) {
    super(
      `Rate limit reached: ${used}/${limit} model-backed requests in the current window. ` +
        `The deterministic investigation is unaffected and still available.`,
    );
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Derive a stable, non-reversible caller id.
 *
 * Vercel sets x-forwarded-for. Behind no proxy there may be nothing, in which
 * case every anonymous caller shares one bucket, which fails safe: the limit
 * becomes stricter, never looser.
 */
export function callerKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Daily salt so the hash cannot be correlated across days.
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${day}`).digest("hex").slice(0, 32);
}

/**
 * Atomically count one request for this caller and enforce the cap.
 *
 * Throws RateLimitedError when the caller is over their limit. The counter is
 * incremented before the check, so a burst of concurrent requests cannot all
 * observe the same pre-increment value.
 */
export async function consumeVisitorQuota(key: string): Promise<{
  used: number;
  limit: number;
}> {
  const graphName = getEnv().FALKORDB_GRAPH;
  const { maxRequests, windowMs } = visitorLimits();
  const now = Date.now();

  const res = await writeQuery<{ used: number; windowStart: number }>(
    graphName,
    `
MERGE (v:AgentVisitor {key: $key})
WITH v, CASE WHEN v.windowStart IS NULL OR $now - v.windowStart > $windowMs
             THEN true ELSE false END AS rolled
SET v.windowStart = CASE WHEN rolled THEN $now ELSE v.windowStart END,
    v.used        = CASE WHEN rolled THEN 1 ELSE coalesce(v.used, 0) + 1 END,
    v.lastSeen    = $now
RETURN v.used AS used, v.windowStart AS windowStart
`.trim(),
    { params: { key, now, windowMs } },
  );

  const used = res.data[0]?.used ?? 0;
  const windowStart = res.data[0]?.windowStart ?? now;

  if (used > maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    throw new RateLimitedError(used, maxRequests, retryAfter);
  }
  return { used, limit: maxRequests };
}

/** Read-only view, for a capability probe. */
export async function visitorUsage(key: string): Promise<number> {
  const graphName = getEnv().FALKORDB_GRAPH;
  const res = await roQuery<{ used: number }>(
    graphName,
    `MATCH (v:AgentVisitor {key: $key}) RETURN coalesce(v.used, 0) AS used`,
    { params: { key } },
  );
  return res.data[0]?.used ?? 0;
}

/** Operator maintenance: clear counters. Not reachable from a request path. */
export async function resetVisitorQuotas(): Promise<number> {
  const graphName = getEnv().FALKORDB_GRAPH;
  const res = await writeQuery<{ c: number }>(
    graphName,
    `MATCH (v:AgentVisitor) WITH collect(v) AS vs
     FOREACH (x IN vs | DETACH DELETE x)
     RETURN size(vs) AS c`,
  );
  return res.data[0]?.c ?? 0;
}
