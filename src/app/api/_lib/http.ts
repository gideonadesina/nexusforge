import { NextResponse } from "next/server";
import { RunAuthorizationError } from "@/lib/runs/authz";
import { InvalidTransitionError } from "@/lib/actions/actions";
import { InvalidDepthError } from "@/lib/graph/depth";
import {
  parseRunTokens,
  withRunToken,
  tokenForRun,
  serializeRunTokenCookie,
  RUN_TOKEN_COOKIE,
} from "@/lib/runs/token-transport";

/**
 * Shared HTTP plumbing for the API routes.
 *
 * Keeps error mapping and credential handling in one place so no individual
 * route can accidentally leak a token or report an authorization failure as a
 * server error.
 */

export interface ApiError {
  error: string;
  code: string;
}

/**
 * Map a thrown error to a status code.
 *
 * Deliberately specific: an authorization failure must never surface as 500,
 * and an invalid state transition is a conflict, not a bad request.
 */
export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof RunAuthorizationError) {
    return NextResponse.json(
      { error: "Not authorized for this analysis run.", code: "UNAUTHORIZED" },
      { status: 403 },
    );
  }
  if (err instanceof InvalidTransitionError) {
    return NextResponse.json({ error: err.message, code: "INVALID_TRANSITION" }, { status: 409 });
  }
  if (err instanceof InvalidDepthError) {
    return NextResponse.json({ error: err.message, code: "INVALID_DEPTH" }, { status: 400 });
  }

  const message = err instanceof Error ? err.message : String(err);

  // A missing root entity is a client error, not a server fault.
  if (/not found in graph/i.test(message)) {
    return NextResponse.json({ error: message, code: "NOT_FOUND" }, { status: 404 });
  }

  // Connection problems are upstream failures. The client module has already
  // redacted credentials and the hostname from this message.
  if (/\[falkordb:/.test(message)) {
    return NextResponse.json(
      { error: `Graph database unavailable: ${message}`, code: "DB_UNAVAILABLE" },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: message, code: "INTERNAL" }, { status: 500 });
}

/* ------------------------------------------------------------------ *
 * Owner-token cookie handling
 * ------------------------------------------------------------------ */

/** Secure attribute is dropped only for local plain-HTTP development. */
function cookieIsSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function readRunToken(req: Request, analysisRunId: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  const match = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${RUN_TOKEN_COOKIE}=`));
  if (!match) return undefined;
  return tokenForRun(parseRunTokens(match.slice(RUN_TOKEN_COOKIE.length + 1)), analysisRunId);
}

/**
 * Attach a newly minted owner token to the response.
 *
 * The token goes into an HttpOnly cookie and is NEVER included in the JSON
 * body, so page scripts cannot read it and it cannot end up in a log or a
 * screenshot of a network response.
 */
export function attachRunToken(
  req: Request,
  res: NextResponse,
  analysisRunId: string,
  ownerToken: string,
): NextResponse {
  const raw = req.headers.get("cookie") ?? "";
  const existingRaw = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${RUN_TOKEN_COOKIE}=`));
  const existing = existingRaw
    ? parseRunTokens(existingRaw.slice(RUN_TOKEN_COOKIE.length + 1))
    : {};

  const updated = withRunToken(existing, analysisRunId, ownerToken);
  res.headers.append(
    "Set-Cookie",
    serializeRunTokenCookie(updated, { secure: cookieIsSecure() }),
  );
  return res;
}

/** Parse a JSON body, tolerating an empty one. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
