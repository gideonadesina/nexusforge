/**
 * Per-visitor rate limiting, the precondition for exposing paid inference
 * publicly.
 *
 * The global budget caps total spend but cannot stop one caller consuming all
 * of it. These tests cover the second limit: it must be server side, shared
 * across instances, atomic under concurrency, and must never store a raw IP.
 *
 * Real FalkorDB. No mocks. No OpenAI calls.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import {
  callerKey,
  consumeVisitorQuota,
  visitorUsage,
  visitorLimits,
  resetVisitorQuotas,
  RateLimitedError,
} from "../src/lib/agent/rate-limit";
import { roQuery, closeDb } from "../src/lib/falkor/client";
import { getEnv } from "../src/lib/env";

const graphName = getEnv().FALKORDB_GRAPH;
const unique = () => `test_${Math.random().toString(36).slice(2, 12)}`;

beforeEach(() => {
  process.env.NF_AGENT_VISITOR_MAX_REQUESTS = "3";
  process.env.NF_AGENT_VISITOR_WINDOW_MS = String(60 * 60 * 1000);
});

afterAll(async () => {
  delete process.env.NF_AGENT_VISITOR_MAX_REQUESTS;
  delete process.env.NF_AGENT_VISITOR_WINDOW_MS;
  await resetVisitorQuotas();
  await closeDb();
});

describe("the limit is enforced", () => {
  it("allows exactly the configured number of requests, then blocks", async () => {
    const key = unique();
    const { maxRequests } = visitorLimits();
    for (let i = 1; i <= maxRequests; i += 1) {
      const r = await consumeVisitorQuota(key);
      expect(r.used).toBe(i);
    }
    await expect(consumeVisitorQuota(key)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("keeps blocking once over the limit", async () => {
    const key = unique();
    for (let i = 0; i < 3; i += 1) await consumeVisitorQuota(key);
    await expect(consumeVisitorQuota(key)).rejects.toThrow(/Rate limit reached/);
    await expect(consumeVisitorQuota(key)).rejects.toThrow(/Rate limit reached/);
  });

  it("reports a retry-after that fits inside the window", async () => {
    const key = unique();
    for (let i = 0; i < 3; i += 1) await consumeVisitorQuota(key);
    try {
      await consumeVisitorQuota(key);
      throw new Error("should have been blocked");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError);
      const retry = (e as RateLimitedError).retryAfterSeconds;
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(visitorLimits().windowMs / 1000);
    }
  });

  it("says the deterministic path is still available, so callers are not dead-ended", async () => {
    const key = unique();
    for (let i = 0; i < 3; i += 1) await consumeVisitorQuota(key);
    await expect(consumeVisitorQuota(key)).rejects.toThrow(/deterministic investigation is unaffected/);
  });
});

describe("visitors are isolated from each other", () => {
  it("one caller exhausting their quota does not block another", async () => {
    const a = unique();
    const b = unique();
    for (let i = 0; i < 3; i += 1) await consumeVisitorQuota(a);
    await expect(consumeVisitorQuota(a)).rejects.toBeInstanceOf(RateLimitedError);

    const r = await consumeVisitorQuota(b);
    expect(r.used).toBe(1);
  });
});

describe("the counter is atomic and shared, not per process", () => {
  it("survives in FalkorDB rather than process memory", async () => {
    const key = unique();
    await consumeVisitorQuota(key);
    await consumeVisitorQuota(key);
    const res = await roQuery<{ used: number }>(
      graphName,
      `MATCH (v:AgentVisitor {key: $key}) RETURN v.used AS used`,
      { params: { key } },
    );
    expect(res.data[0]?.used).toBe(2);
    expect(await visitorUsage(key)).toBe(2);
  });

  it("does not let concurrent requests all pass the same check", async () => {
    const key = unique();
    // Ten simultaneous callers against a limit of three.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeVisitorQuota(key)),
    );
    const allowed = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(allowed).toBe(3);
    expect(outcomes.length - allowed).toBe(7);
  });
});

describe("the window rolls", () => {
  it("resets the count once the window has elapsed", async () => {
    const key = unique();
    process.env.NF_AGENT_VISITOR_WINDOW_MS = "1";
    await consumeVisitorQuota(key);
    await new Promise((r) => setTimeout(r, 15));
    const r = await consumeVisitorQuota(key);
    expect(r.used).toBe(1);
  });
});

describe("caller identity never stores a raw address", () => {
  it("derives a hash from x-forwarded-for", () => {
    const k = callerKey(
      new Request("http://local/api/ask", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }),
    );
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).not.toContain("203.0.113.9");
  });

  it("gives the same caller the same key within a day", () => {
    const h = { "x-forwarded-for": "203.0.113.9" };
    expect(callerKey(new Request("http://local/a", { headers: h }))).toBe(
      callerKey(new Request("http://local/b", { headers: h })),
    );
  });

  it("gives different callers different keys", () => {
    const a = callerKey(new Request("http://local/a", { headers: { "x-forwarded-for": "203.0.113.9" } }));
    const b = callerKey(new Request("http://local/a", { headers: { "x-forwarded-for": "198.51.100.4" } }));
    expect(a).not.toBe(b);
  });

  it("falls back to a single shared bucket when no address is present, which fails strict", () => {
    const a = callerKey(new Request("http://local/a"));
    const b = callerKey(new Request("http://local/b"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses the first hop of x-forwarded-for, not a spoofable trailing entry", () => {
    const real = callerKey(new Request("http://local/a", { headers: { "x-forwarded-for": "203.0.113.9" } }));
    const chained = callerKey(
      new Request("http://local/a", { headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.4" } }),
    );
    expect(chained).toBe(real);
  });
});
