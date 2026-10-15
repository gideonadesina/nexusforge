import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
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
  rootEntityId: z.string().min(1),
  goal: z.string().max(300).optional(),
});

export async function GET() {
  // Capability probe, so the UI can describe the agent honestly.
  return NextResponse.json({
    enabled: agentEnabled(),
    llmConfigured: llmConfigured(),
    mode: llmConfigured() ? "llm" : "scripted",
    note: llmConfigured()
      ? "A language model planner is configured."
      : "No language model is configured. The scripted planner is deterministic and is not a model.",
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

    const graphName = getEnv().FALKORDB_GRAPH;
    const goal =
      parsed.data.goal ??
      `Determine what is exposed by a change to ${parsed.data.rootEntityId}, and on what evidence.`;

    const result = await runAgent(
      goal,
      parsed.data.rootEntityId,
      { graphName },
      scriptedPlanner(parsed.data.rootEntityId),
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentDisabledError) {
      return NextResponse.json({ error: err.message, code: "AGENT_DISABLED" }, { status: 503 });
    }
    return errorResponse(err);
  }
}
