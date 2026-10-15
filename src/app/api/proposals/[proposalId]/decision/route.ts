import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import {
  approveProposal,
  rejectProposal,
  getProposal,
  listAuditEventsForProposal,
} from "@/lib/actions/actions";
import { RunAuthorizationError } from "@/lib/runs/authz";
import { APPROVAL_SEMANTICS } from "@/lib/actions/types";
import {
  errorResponse,
  readRunToken,
  readJson,
} from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Record a decision on an action proposal.
 *
 * This is a DECISION, not an execution. NexusForge performs no external
 * action, and the response says so explicitly so a client cannot present it
 * as completed work.
 *
 * The owner token comes from the HttpOnly cookie, never from the request
 * body -- a token in a body would be logged by any intermediary.
 */

const BodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  const started = Date.now();
  try {
    const { proposalId } = await context.params;

    const parsed = BodySchema.safeParse(await readJson(req));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          code: "INVALID_REQUEST",
        },
        { status: 400 },
      );
    }

    const graphName = getEnv().FALKORDB_GRAPH;

    // Resolve which run owns this proposal so we can look up the right token.
    const existing = await getProposal(graphName, proposalId);
    if (!existing) {
      return NextResponse.json(
        { error: `Proposal ${proposalId} not found.`, code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const ownerToken = readRunToken(req, existing.analysisRunId);
    if (!ownerToken) {
      // No credential at all: reject before touching the database.
      throw new RunAuthorizationError(
        "No owner token for this analysis run. Only the browser that started the run may decide its proposals.",
      );
    }

    const creds = { analysisRunId: existing.analysisRunId, ownerToken };
    const decide = parsed.data.decision === "APPROVED" ? approveProposal : rejectProposal;
    const result = await decide(graphName, creds, proposalId, parsed.data.note ?? null);

    const [proposal, auditEvents] = await Promise.all([
      getProposal(graphName, proposalId),
      listAuditEventsForProposal(graphName, proposalId),
    ]);

    return NextResponse.json({
      proposal,
      auditEvents,
      transition: result,
      // Carried in the payload so a UI cannot quietly drop the caveat.
      executed: false,
      semantics: APPROVAL_SEMANTICS,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
