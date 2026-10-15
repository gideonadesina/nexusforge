/**
 * Stage 2A — owner-token transport design (requirement 11, delivery).
 *
 * UNIT TESTS. Pure functions, no database, no HTTP. The transport is designed
 * but deliberately not wired to any route in Stage 2A.
 */
import { describe, it, expect } from "vitest";
import {
  parseRunTokens,
  withRunToken,
  tokenForRun,
  serializeRunTokenCookie,
  redactToken,
  RUN_TOKEN_COOKIE,
  MAX_TRACKED_RUNS,
} from "../src/lib/runs/token-transport";

describe("cookie carries credentials for multiple concurrent runs", () => {
  it("round-trips a multi-run map", () => {
    const map = withRunToken(withRunToken({}, "run-a", "tok-a"), "run-b", "tok-b");
    const cookie = serializeRunTokenCookie(map);
    const value = cookie.split(";")[0]!.slice(`${RUN_TOKEN_COOKIE}=`.length);

    const parsed = parseRunTokens(value);
    expect(parsed).toEqual({ "run-a": "tok-a", "run-b": "tok-b" });
    expect(tokenForRun(parsed, "run-a")).toBe("tok-a");
    expect(tokenForRun(parsed, "run-b")).toBe("tok-b");
  });

  it("a new run does not evict an existing one", () => {
    const map = withRunToken(withRunToken({}, "run-a", "tok-a"), "run-b", "tok-b");
    expect(Object.keys(map)).toEqual(["run-a", "run-b"]);
  });

  it("returns undefined for a run the caller does not hold", () => {
    expect(tokenForRun({ "run-a": "tok-a" }, "run-z")).toBeUndefined();
  });

  it("caps the number of tracked runs, keeping the most recent", () => {
    let map = {};
    for (let i = 0; i < MAX_TRACKED_RUNS + 5; i += 1) {
      map = withRunToken(map, `run-${i}`, `tok-${i}`);
    }
    const keys = Object.keys(map);
    expect(keys.length).toBe(MAX_TRACKED_RUNS);
    expect(keys.at(-1)).toBe(`run-${MAX_TRACKED_RUNS + 4}`);
    expect(keys).not.toContain("run-0");
  });
});

describe("malformed cookies fail closed", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["not json", "%7Bnot-json"],
    ["json array", encodeURIComponent("[1,2,3]")],
    ["json string", encodeURIComponent('"nope"')],
    ["json null", encodeURIComponent("null")],
    ["nested objects", encodeURIComponent('{"a":{"b":"c"}}')],
    ["numeric values", encodeURIComponent('{"a":123}')],
  ])("yields an empty map for %s", (_label, value) => {
    expect(parseRunTokens(value as string | undefined | null)).toEqual({});
  });

  it("drops only the invalid entries from a partially valid map", () => {
    const parsed = parseRunTokens(encodeURIComponent('{"good":"tok","bad":42,"":"x"}'));
    expect(parsed).toEqual({ good: "tok" });
  });
});

describe("cookie security attributes are non-negotiable", () => {
  it("sets HttpOnly, SameSite, Path, Max-Age and Secure by default", () => {
    const cookie = serializeRunTokenCookie({ "run-a": "tok-a" });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=\d+/);
    expect(cookie).toContain("Secure");
  });

  it("omits Secure only when explicitly disabled for local HTTP", () => {
    expect(serializeRunTokenCookie({ a: "b" }, { secure: false })).not.toContain("Secure");
  });

  it("never reveals a token through the redaction helper", () => {
    const token = "super-secret-owner-token-value";
    expect(redactToken(token)).not.toContain("super");
    expect(redactToken(token)).not.toContain(token.slice(0, 4));
    expect(redactToken(token)).toBe("[redacted-owner-token]");
  });
});
