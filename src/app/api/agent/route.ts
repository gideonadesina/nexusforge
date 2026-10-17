import { NextResponse } from "next/server";
import { z } from "zod";
import { orgContext } from "@/lib/org/packs";
import { runAgent, agentEnabled, AgentDisabledError, globalCallsUsed } from "@/lib/agent/loop";
import { scriptedPlanner, llmConfigured } from "@/lib/agent/planners";
import { toolCatalogue } from "@/lib/agent/tools";
import { errorResponse, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Constrained agent investigation.
 *
 * The agent can read the graph and explain what it finds. It CANNOT approve
 * or reject anything: no such tool exists, so authority stays with the human
 * holding the run's owner token.
 */

const BodySchema = z.object({
  org: z.string().optional(),
  rootEntityId: z.string().min(1),
  goal: z.string().max(300).optional(),
});

export async function GET() {
  // Capability probe, so the UI can describe the agent honestly.
  //
  // This route's own mode is ALWAYS "scripted": its POST handler constructs
  // scriptedPlanner and nothing else. It previously reported "llm" whenever a
  // key happened to be configured, which would have claimed model reasoning
  // for a deterministic procedure as soon as the pilot switched the model on.
  // Whether a model is available is a separate fact about a different route.
  return NextResponse.json({
    enabled: agentEnabled(),
    mode: "scripted",
    note:
      "This route always runs the deterministic scripted planner. It is not a " +
      "language model and does not call one. Model-backed investigation is a " +
      "separate route.",
    modelBackedRoute: "/api/ask",
    modelAvailableOnAskRoute: llmConfigured(),
    tools: toolCatalogue(),
    globalCallsUsed: globalCallsUsed(),
  });
}

export async function POST(req: Request) {
  try {
    if (!agentEnabled()) throw new AgentDisabledError();

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

    const { graphName } = orgContext(parsed.data.org);
    const goal =
      parsed.data.goal ??
      `Determine what is exposed by a change to ${parsed.data.rootEntityId}, and on what evidence.`;

    const MAX_STEPS = 8;
    const planner = scriptedPlanner(parsed.data.rootEntityId, MAX_STEPS);
    const result = await runAgent(goal, parsed.data.rootEntityId, { graphName }, planner, {
      maxSteps: MAX_STEPS,
      maxWallClockMs: 55_000,
      maxToolMs: 15_000,
    });

    return NextResponse.json({
      ...result,
      // The grounded conclusion, composed from recorded tool results.
      finalText: planner.finalText(),
    });
  } catch (err) {
    if (err instanceof AgentDisabledError) {
      return NextResponse.json({ error: err.message, code: "AGENT_DISABLED" }, { status: 503 });
    }
    return errorResponse(err);
  }
}
