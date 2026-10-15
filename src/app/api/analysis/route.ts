import { NextResponse } from "next/server";
import { z } from "zod";
import { orgContext } from "@/lib/org/packs";
import { publicView } from "@/lib/org/registry";
import { ensureSeeded } from "@/lib/graph/seed";
import { runAndPersistAnalysis } from "@/lib/runs/analyse-and-persist";
import { proposeActions } from "@/lib/actions/actions";
import { listFindings } from "@/lib/runs/persist";
import { listProposals } from "@/lib/actions/actions";
import { DepthSchema } from "@/lib/graph/depth";
import {
  errorResponse,
  attachRunToken,
  readJson,
} from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Start a new analysis.
 *
 * Runs the real graph traversal, persists the run and its findings, generates
 * deterministic action proposals, and returns the whole result. The owner
 * token is delivered ONLY as an HttpOnly cookie -- never in the body.
 */

const BodySchema = z.object({
  /** Allowlisted organization id. NEVER a graph name. */
  org: z.string().optional(),
  rootEntityId: z.string().min(1, "rootEntityId is required"),
  // Depth is the one value interpolated into Cypher, so it is validated by
  // the same strict schema the engine uses. No coercion: a JSON string is
  // rejected rather than silently converted.
  maxDepth: DepthSchema.optional(),
});

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = await readJson(req);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          code: "INVALID_REQUEST",
        },
        { status: 400 },
      );
    }

    const { org, pack, graphName } = orgContext(parsed.data.org);
    // The free tier can reclaim an idle instance, so rebuild the synthetic
    // organization if it is missing. Never silently fabricates findings.
    await ensureSeeded(graphName, pack);

    const result = await runAndPersistAnalysis(graphName, parsed.data.rootEntityId, {
      ...(parsed.data.maxDepth !== undefined ? { maxDepth: parsed.data.maxDepth } : {}),
    });

    const creds = {
      analysisRunId: result.run.analysisRunId,
      ownerToken: result.run.ownerToken,
    };
    await proposeActions(graphName, creds, result.analysis);

    const [findings, proposals] = await Promise.all([
      listFindings(graphName, result.run.analysisRunId),
      listProposals(graphName, result.run.analysisRunId),
    ]);

    const res = NextResponse.json({
      organization: publicView(org),
      analysisRunId: result.run.analysisRunId,
      root: {
        entityId: result.analysis.rootEntityId,
        entityType: result.analysis.rootEntityType,
        name: result.analysis.rootName,
      },
      maxDepth: result.analysis.maxDepth,
      ruleId: result.analysis.ruleId,
      distinctImpactedCount: result.analysis.distinctImpactedCount,
      totalPathCount: result.analysis.totalPathCount,
      unevidencedEntityIds: result.analysis.unevidencedEntityIds,
      impacted: result.analysis.impacted,
      findings,
      proposals,
      auditEvents: [],
      latencyMs: Date.now() - started,
    });

    return attachRunToken(req, res, result.run.analysisRunId, result.run.ownerToken);
  } catch (err) {
    return errorResponse(err);
  }
}
