/**
 * Owner-token transport design.
 *
 * NOT WIRED UP. There is no HTTP surface in this project yet; this module
 * defines the mechanism so that when a route handler is added in Stage 2B it
 * cannot invent a weaker one. Pure functions only -- no framework imports.
 *
 * Shape: one cookie holding a JSON map of `analysisRunId -> ownerToken`, so a
 * single visitor can hold credentials for several concurrent runs without the
 * cookies colliding or a newer run silently replacing an older one.
 *
 * Security attributes are non-negotiable:
 *   HttpOnly  - the token must never be readable by page JavaScript
 *   Secure    - never sent over plaintext HTTP
 *   SameSite  - Lax, so a cross-site form post cannot mutate a run
 *   Path=/    - available to every route that needs it
 */

export const RUN_TOKEN_COOKIE = "nf_run_tokens";

/** Cookie lifetime. Demo runs are short-lived; this is not a login session. */
export const RUN_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

export type RunTokenMap = Record<string, string>;

/**
 * Parse the cookie value into a run -> token map.
 *
 * Never throws: a malformed or tampered cookie yields an empty map, which
 * results in an authorization failure rather than a server error.
 */
export function parseRunTokens(cookieValue: string | undefined | null): RunTokenMap {
  if (!cookieValue) return {};
  try {
    const decoded = decodeURIComponent(cookieValue);
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: RunTokenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && k.length > 0 && v.length > 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Cap stored credentials so the cookie cannot grow without bound. */
export const MAX_TRACKED_RUNS = 10;

/**
 * Add a run's token to the map, evicting the oldest entries beyond the cap.
 * Insertion order is preserved, so the most recent runs survive.
 */
export function withRunToken(
  existing: RunTokenMap,
  analysisRunId: string,
  ownerToken: string,
): RunTokenMap {
  const merged: RunTokenMap = { ...existing, [analysisRunId]: ownerToken };
  const keys = Object.keys(merged);
  if (keys.length <= MAX_TRACKED_RUNS) return merged;
  const keep = keys.slice(keys.length - MAX_TRACKED_RUNS);
  const trimmed: RunTokenMap = {};
  for (const k of keep) {
    const v = merged[k];
    if (v !== undefined) trimmed[k] = v;
  }
  return trimmed;
}

/** Look up the token for a run, if the caller holds one. */
export function tokenForRun(map: RunTokenMap, analysisRunId: string): string | undefined {
  return map[analysisRunId];
}

export interface CookieOptions {
  /** Set false only for local HTTP development. Production must be true. */
  secure?: boolean;
  maxAgeSeconds?: number;
}

/**
 * Build the `Set-Cookie` header value.
 *
 * The token appears in this string by necessity -- it is being delivered to
 * its owner. The returned value must therefore be written straight to a
 * response header and never logged.
 */
export function serializeRunTokenCookie(
  map: RunTokenMap,
  options: CookieOptions = {},
): string {
  const { secure = true, maxAgeSeconds = RUN_TOKEN_MAX_AGE_SECONDS } = options;
  const value = encodeURIComponent(JSON.stringify(map));
  const parts = [
    `${RUN_TOKEN_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Redact a token for any diagnostic output. Returns a fixed marker rather than
 * a prefix: even a few characters of a credential should not reach a log.
 */
export function redactToken(_token: string): string {
  return "[redacted-owner-token]";
}
