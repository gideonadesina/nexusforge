import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { writeQuery } from "../falkor/client";
import { assertServerOnly } from "../server-guard";

/**
 * Run-scoped authorization.
 *
 * An `analysisRunId` is an IDENTIFIER, not a credential. Anyone who sees a run
 * in a URL or a log knows its id. Mutating a run therefore additionally
 * requires an opaque `ownerToken` that only the creating visitor ever holds.
 *
 * Design notes:
 *  - the token is 32 cryptographically random bytes, base64url encoded
 *  - only SHA-256(token) is stored on the AnalysisRun node
 *  - authorization is enforced INSIDE the mutating Cypher statement, by
 *    matching on `{analysisRunId, ownerTokenHash}` in the same query that
 *    performs the write. There is no separate check-then-write step, so there
 *    is no TOCTOU window.
 *  - a failed authorization matches zero rows, so the write simply never
 *    happens. Nothing is created, nothing is changed.
 *
 * What this is NOT: proof of human identity, and not permission to perform a
 * particular business action. Stage 2B must enforce action-specific approval
 * authority on top of this.
 */

export class RunAuthorizationError extends Error {
  constructor(message = "Not authorized to mutate this analysis run.") {
    super(message);
    this.name = "RunAuthorizationError";
  }
}

const TOKEN_BYTES = 32;

/** Generate a fresh, opaque owner token. Returned to the caller exactly once. */
export function generateOwnerToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex digest of a token. Only this value is ever persisted. */
export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * The authoritative check happens in Cypher; this helper exists for the rare
 * in-process comparison so that those paths do not leak timing information.
 */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Credentials required for any run-scoped mutation. */
export interface RunCredentials {
  analysisRunId: string;
  ownerToken: string;
}

function assertCredentialShape(creds: RunCredentials | undefined): RunCredentials {
  if (!creds) throw new RunAuthorizationError("Missing run credentials.");
  const { analysisRunId, ownerToken } = creds;
  if (typeof analysisRunId !== "string" || analysisRunId.length === 0) {
    throw new RunAuthorizationError("Missing or malformed analysisRunId.");
  }
  if (typeof ownerToken !== "string" || ownerToken.length === 0) {
    throw new RunAuthorizationError("Missing or malformed ownerToken.");
  }
  return creds;
}

/**
 * THE single entry point for every run-scoped mutation.
 *
 * Callers supply only the body of their statement. This function prepends the
 * authorization MATCH, so a future action handler physically cannot write to a
 * run without passing the ownership check -- forgetting to authorize would
 * mean not calling this function at all, which is visible in review.
 *
 * The caller's `body` must be written to operate on the bound variable `run`.
 * `$runId` and `$ownerTokenHash` are reserved parameter names.
 *
 * @param body        Cypher executed only if authorization matches.
 * @param returnClause What to RETURN. Must include `authorized` truthiness.
 */
export async function withRunAuthorization<T = Record<string, unknown>>(
  graphName: string,
  creds: RunCredentials,
  body: string,
  returnClause: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  assertServerOnly("withRunAuthorization");
  const { analysisRunId, ownerToken } = assertCredentialShape(creds);

  if ("runId" in params || "ownerTokenHash" in params) {
    throw new Error(
      "Parameters 'runId' and 'ownerTokenHash' are reserved by the authorization layer.",
    );
  }

  // The ownership predicate and the mutation are one statement. If the MATCH
  // binds nothing, every downstream clause is skipped and no write occurs.
  const cypher = `
MATCH (run:AnalysisRun {analysisRunId: $runId, ownerTokenHash: $ownerTokenHash})
${body}
${returnClause}
`.trim();

  const res = await writeQuery<T>(graphName, cypher, {
    params: {
      ...params,
      runId: analysisRunId,
      ownerTokenHash: hashOwnerToken(ownerToken),
    },
  });

  if (res.data.length === 0) {
    // Zero rows means the authorization MATCH failed: wrong token, wrong run,
    // or no such run. The database was not modified.
    throw new RunAuthorizationError();
  }

  return res.data;
}
