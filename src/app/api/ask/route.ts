import { NextResponse } from "next/server";
import { z } from "zod";
import { orgContext } from "@/lib/org/packs";
import { publicView, listPublicOrganizations } from "@/lib/org/registry";
import { readGraphFacts, suggestQuestions, resolveQuestion } from "@/lib/agent/questions";
import { composeAnswer } from "@/lib/agent/answer";
import { runAgent, agentEnabled, AgentDisabledError } from "@/lib/agent/loop";
import { openAiPlanner, openAiConfigured, type UsageTally } from "@/lib/agent/openai-planner";
import { BudgetExceededError, budgetSnapshot } from "@/lib/agent/budget";
import { errorResponse, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Ask NexusForge.
 *
 * The deterministic path always runs and always produces the answer's facts.
 * A model, when explicitly enabled, adds tool-planning and a narration layer
 * on top — it never replaces the grounded answer and never decides what is
 * true.
 *
 * Model use requires BOTH a key and NF_AGENT_LLM=on, so a key alone can never
 * start billing. Public deployments stay deterministic until the flag is set.
 */

const BodySchema = z.object({
  org: z.string().optional(),
  question: z.string().min(1).max(400),
  analysisRunId: z.string().optional(),
  /** Opt in to the model planner for this request. */
  useModel: z.boolean().optional(),
});

/** Second flag, independent of the key, so a key alone cannot start spending. */
function llmEnabled(): boolean {
  return (process.env.NF_AGENT_LLM ?? "off").toLowerCase() === "on" && openAiConfigured();
}

export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("org");
    const { org, pack, graphName } = orgContext(orgId);
    const facts = await readGraphFacts(graphName, pack);
    return NextResponse.json({
      organization: publicView(org),
      organizations: listPublicOrganizations(),
      suggestions: suggestQuestions(facts),
      entityCount: facts.entities.length,
      modelAvailable: llmEnabled(),
      budget: llmEnabled() ? await budgetSnapshot() : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
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

    const { org, pack, graphName } = orgContext(parsed.data.org);
    const facts = await readGraphFacts(graphName, pack);
    const defaultRoot = pack.scenarioRootId ?? facts.topRoot?.id ?? null;

    const resolved = resolveQuestion(parsed.data.question, facts, defaultRoot);

    // Grounded answer FIRST. This is the authoritative content.
    const grounded = await composeAnswer(graphName, resolved, parsed.data.analysisRunId);

    const wantsModel = parsed.data.useModel === true && llmEnabled() && agentEnabled();

    if (!wantsModel) {
      return NextResponse.json({
        question: parsed.data.question,
        organization: publicView(org),
        resolved,
        answer: grounded,
        agent: null,
        mode: "deterministic",
        modelAvailable: llmEnabled(),
        latencyMs: Date.now() - started,
      });
    }

    // Model planning layer. Failures degrade to the grounded answer rather
    // than failing the request.
    const tally: UsageTally = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let agentResult = null;
    let agentError: string | null = null;

    try {
      const MAX_AGENT_STEPS = 7;
      const planner = openAiPlanner(
        resolved.rootEntityId ?? defaultRoot ?? "",
        tally,
        MAX_AGENT_STEPS,
      );
      agentResult = await runAgent(
        parsed.data.question,
        resolved.rootEntityId ?? undefined,
        { graphName },
        planner,
        { maxSteps: MAX_AGENT_STEPS, maxWallClockMs: 50_000, maxToolMs: 15_000 },
      );
      (agentResult as unknown as { finalText?: string | null }).finalText = planner.finalText();
    } catch (err) {
      if (err instanceof BudgetExceededError) agentError = err.message;
      else if (err instanceof AgentDisabledError) agentError = err.message;
      else agentError = err instanceof Error ? err.message : String(err);
    }

    return NextResponse.json({
      question: parsed.data.question,
      organization: publicView(org),
      resolved,
      answer: grounded,
      agent: agentResult,
      agentError,
      usage: tally,
      mode: agentResult ? "model-planned" : "deterministic-fallback",
      modelAvailable: true,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, code: "BUDGET_EXCEEDED" }, { status: 429 });
    }
    return errorResponse(err);
  }
}
