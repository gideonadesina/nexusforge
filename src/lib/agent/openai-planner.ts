import { z } from "zod";
import type { Planner, PlannedCall, LoopState } from "./loop";
import { toolCatalogue } from "./tools";
import { reserve, reconcile } from "./budget";
import { assertServerOnly } from "../server-guard";

/**
 * OpenAI planner adapter (Responses API).
 *
 * Scope is deliberately tiny: the model chooses WHICH approved tool to call
 * next and explains why. It never sees Cypher, never receives a tool that
 * writes, and cannot approve anything -- those constraints live in
 * `tools.ts` and the loop, not in the prompt, so a prompt injection or a
 * misbehaving model cannot widen them.
 *
 * Implemented with `fetch` rather than the `openai` SDK. The surface we need
 * is one endpoint, and adding a dependency costs ~20 minutes of install on
 * this machine for no behavioural gain. Trade-off recorded in docs/LOG.md.
 */

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const DEFAULT_MODEL = process.env.NF_AGENT_MODEL ?? "gpt-6-luna";

/** Conservative estimate charged before the call, reconciled afterwards. */
const ESTIMATED_TOKENS_PER_TURN = 1_500;
const REQUEST_TIMEOUT_MS = Number(process.env.NF_AGENT_REQUEST_TIMEOUT_MS ?? 20_000);
const MAX_OUTPUT_TOKENS = 400;
/** "low" | "medium" | "high". Tunable without a redeploy. */
const REASONING_EFFORT = process.env.NF_AGENT_REASONING_EFFORT ?? "low";

export class OpenAiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiUnavailableError";
  }
}

export function openAiConfigured(): boolean {
  return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
}

/** Usage actually reported by the provider, accumulated across the session. */
export interface UsageTally {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const SYSTEM_INSTRUCTIONS = `
You are the planning component of NexusForge, an organizational dependency
investigation engine. FalkorDB is the sole authority for all graph facts.

Your ONLY job is to choose which approved tool to call next, and to say why in
one short sentence.

Hard rules:
- You do not know any organizational facts. Everything you report must come
  from a tool result. If a tool has not told you something, you do not know it.
- Never invent entities, relationships, qualifications, deadlines, severities
  or evidence. If evidence is missing, say it is missing.
- You cannot approve, reject or execute anything. No such tool exists. Only a
  human holding the run's owner token can record a decision.
- Prefer verifying weak claims: entities with PARTIAL or MISSING evidence, and
  entities reachable by several routes, deserve attention first.
- The changed entity is the SOURCE of the change, not an affected entity.
  Never call explain_path or get_evidence with entityId equal to the root --
  there is no finding for it and the call will fail.
- analyse_impact already reports evidence status for every entity. Only call
  get_evidence when you need the actual source text for a specific finding.

You have a STRICT limit on tool calls. Budget them: survey, analyse, then
verify at most one or two findings. You MUST produce your summary before the
limit is reached, or the investigation ends with no answer.

Call exactly one tool per turn. When you have enough, reply with a short
plain-text summary citing only what the tools returned, and call no tool.
`.trim();

/** Shape of the Responses API payload we depend on. */
const ResponseSchema = z.object({
  output: z
    .array(
      z.object({
        type: z.string(),
        name: z.string().optional(),
        arguments: z.string().optional(),
        call_id: z.string().optional(),
        content: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

type ConversationItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export function openAiPlanner(
  rootEntityId: string,
  tally: UsageTally,
  /** Must match the loop's budget so the model can plan within it. */
  maxSteps = 7,
): Planner & { finalText: () => string | null } {
  assertServerOnly("openAiPlanner");

  const conversation: ConversationItem[] = [
    {
      role: "user",
      content:
        `Investigate what a change to the entity "${rootEntityId}" exposes, and on what evidence. ` +
        `Start by establishing what the graph contains.`,
    },
  ];
  let lastCallId: string | null = null;
  let finalText: string | null = null;
  let stepsSeen = 0;

  return {
    mode: "llm",
    label: `OpenAI ${DEFAULT_MODEL} (model-planned, tools constrained)`,
    finalText: () => finalText,

    async next(state: LoopState): Promise<PlannedCall | null> {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new OpenAiUnavailableError("OPENAI_API_KEY is not set.");

      // Feed back the result of the previous tool call, plus how many calls
      // remain. Without this the model cannot budget and simply runs out.
      const newSteps = state.steps.slice(stepsSeen);
      for (const step of newSteps) {
        if (lastCallId) {
          const remaining = Math.max(0, maxSteps - state.steps.length);
          conversation.push({
            type: "function_call_output",
            call_id: lastCallId,
            output: JSON.stringify({
              ok: step.ok,
              summary: step.summary,
              tool_calls_remaining: remaining,
              note:
                remaining <= 1
                  ? "This is your LAST opportunity. Reply with your summary now and call no tool."
                  : undefined,
            }),
          });
          lastCallId = null;
        }
      }
      stepsSeen = state.steps.length;

      // Charge the budget BEFORE calling out, so concurrent instances cannot
      // collectively overshoot while each waits on its own response.
      await reserve(ESTIMATED_TOKENS_PER_TURN);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let raw: unknown;
      try {
        const res = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            instructions: SYSTEM_INSTRUCTIONS,
            input: conversation,
            tools: toolCatalogue().map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            })),
            tool_choice: "auto",
            max_output_tokens: MAX_OUTPUT_TOKENS,
            // Low effort first: tool selection here is a short, well-scoped
            // choice from five options, not a reasoning-heavy task. Raise to
            // medium only if selection quality proves insufficient.
            reasoning: { effort: REASONING_EFFORT },
            store: false,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          // Never echo the key; the body may quote request headers.
          throw new OpenAiUnavailableError(
            `OpenAI responded ${res.status}: ${body.slice(0, 300).replace(apiKey, "***")}`,
          );
        }
        raw = await res.json();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new OpenAiUnavailableError(`OpenAI request exceeded ${REQUEST_TIMEOUT_MS} ms.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      const parsed = ResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new OpenAiUnavailableError("Unexpected response shape from OpenAI.");
      }

      // Reconcile the estimate against reported usage.
      const usage = parsed.data.usage;
      const actual = usage?.total_tokens ?? ESTIMATED_TOKENS_PER_TURN;
      await reconcile(ESTIMATED_TOKENS_PER_TURN, actual);
      tally.requests += 1;
      tally.inputTokens += usage?.input_tokens ?? 0;
      tally.outputTokens += usage?.output_tokens ?? 0;
      tally.totalTokens += actual;

      const call = parsed.data.output.find((o) => o.type === "function_call");
      if (!call?.name) {
        finalText =
          parsed.data.output
            .flatMap((o) => o.content ?? [])
            .map((c) => c.text ?? "")
            .join(" ")
            .trim() || null;
        return null;
      }

      // Record the model's own turn so the next request has full context.
      conversation.push({
        type: "function_call",
        call_id: call.call_id ?? "call_0",
        name: call.name,
        arguments: call.arguments ?? "{}",
      });
      lastCallId = call.call_id ?? "call_0";

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        // Malformed arguments are passed through; the loop's Zod validation
        // rejects them and records the failure as a visible step.
        args = {};
      }

      return {
        tool: call.name,
        args,
        rationale: "Chosen by the model from the approved tool list.",
      };
    },
  };
}
