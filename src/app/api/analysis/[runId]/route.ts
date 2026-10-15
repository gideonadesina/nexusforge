import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getRun, listFindings } from "@/lib/runs/persist";
import { listProposals, listAuditEvents } from "@/lib/actions/actions";
import { errorResponse, readRunToken } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Read a persisted analysis run with its findings, proposals and audit trail.
 *
 * Reads are not token-gated (the run id is already an identifier, and the
 * underlying data is synthetic), but the response reports whether the caller
 * holds the owner token so the UI can enable or disable approval controls
 * honestly rather than offering buttons that will 403.
 *
 * `getRun` never returns `ownerTokenHash`.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const started = Date.now();
  try {
    const { runId } = await context.params;
    const graphName = getEnv().FALKORDB_GRAPH;

    const run = await getRun(graphName, runId);
    if (!run) {
      return NextResponse.json(
        { error: `Analysis run ${runId} not found.`, code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const [findings, proposals, auditEvents] = await Promise.all([
      listFindings(graphName, runId),
      listProposals(graphName, runId),
      listAuditEvents(graphName, runId),
    ]);

    return NextResponse.json({
      run,
      findings,
      proposals,
      auditEvents,
      // Presence of a credential, never the credential itself.
      canDecide: readRunToken(req, runId) !== undefined,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
