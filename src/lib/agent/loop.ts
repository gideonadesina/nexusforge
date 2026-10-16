import { getTool, TOOLS, type ToolContext } from "./tools";

/**
 * The constrained agent loop.
 *
 * Plan -> call a tool -> observe -> repeat, under a hard budget. The planner
 * is pluggable: today a deterministic script, later a model. Everything the
 * loop enforces (budgets, timeouts, validation, the kill switch) sits OUTSIDE
 * the planner, so swapping in a model cannot relax any limit.
 */

export type PlannerMode = "scripted" | "llm";

export interface PlannedCall {
  tool: string;
  args: Record<string, unknown>;
  /** Why the planner chose this step. Shown to the user. */
  rationale: string;
}

export interface Planner {
  mode: PlannerMode;
  /** Human-readable label. Scripted mode must never be presented as reasoning. */
  label: string;
  next(state: LoopState): Promise<PlannedCall | null>;
}

export interface TranscriptStep {
  index: number;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  ok: boolean;
  summary: string;
  durationMs: number;
  error?: string;
}

export interface LoopState {
  goal: string;
  rootEntityId: string | undefined;
  steps: TranscriptStep[];
  /**
   * Structured payloads from successful calls, keyed by tool name (latest
   * wins). Kept out of `steps` because the transcript is what we show the
   * user, while this is what the planner reasons over.
   */
  results: Map<string, unknown>;
  ctx: ToolContext;
}

export interface AgentBudget {
  /** Hard cap on tool calls in one session. */
  maxSteps: number;
  /** Wall-clock cap for the whole session. */
  maxWallClockMs: number;
  /** Per-tool-call cap. */
  maxToolMs: number;
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 8,
  maxWallClockMs: 45_000,
  maxToolMs: 15_000,
};

export class AgentDisabledError extends Error {
  constructor() {
    super("The agent is disabled by the NF_AGENT_ENABLED kill switch.");
    this.name = "AgentDisabledError";
  }
}

/**
 * Kill switch, now DEFAULT-OFF.
 *
 * It previously defaulted to on, on the reasoning that the scripted planner
 * makes no external calls. That reasoning was incomplete: the agent's read
 * tools called `ensureSeeded` with no domain pack, so merely *reading*
 * through the agent could have seeded the education pack into another
 * organization's graph. Being free of API cost is not the same as being safe.
 *
 * Default-off means the agent cannot run anywhere -- production, preview or a
 * developer's laptop -- unless someone explicitly sets NF_AGENT_ENABLED=true.
 * This is independent of NF_AGENT_LLM, which only governs paid inference.
 */
export function agentEnabled(): boolean {
  return (process.env.NF_AGENT_ENABLED ?? "false").toLowerCase() === "true";
}

/** Process-wide counter, so a runaway client cannot exhaust the instance. */
let globalCallCount = 0;
const GLOBAL_CALL_CAP = Number(process.env.NF_AGENT_GLOBAL_CALL_CAP ?? 2000);

export function globalCallsUsed(): number {
  return globalCallCount;
}

export interface AgentRunResult {
  goal: string;
  mode: PlannerMode;
  plannerLabel: string;
  steps: TranscriptStep[];
  stoppedBecause: string;
  totalMs: number;
  /** Explicitly surfaced so a UI cannot imply the agent acted. */
  canApprove: false;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms),
    ),
  ]);
}

export async function runAgent(
  goal: string,
  rootEntityId: string | undefined,
  ctx: ToolContext,
  planner: Planner,
  budget: AgentBudget = DEFAULT_BUDGET,
): Promise<AgentRunResult> {
  if (!agentEnabled()) throw new AgentDisabledError();

  const started = Date.now();
  const state: LoopState = {
    goal,
    rootEntityId,
    steps: [],
    results: new Map<string, unknown>(),
    ctx,
  };
  let stoppedBecause = "planner finished";

  while (true) {
    if (state.steps.length >= budget.maxSteps) {
      stoppedBecause = `step budget reached (${budget.maxSteps})`;
      break;
    }
    if (Date.now() - started > budget.maxWallClockMs) {
      stoppedBecause = `time budget reached (${budget.maxWallClockMs} ms)`;
      break;
    }
    if (globalCallCount >= GLOBAL_CALL_CAP) {
      stoppedBecause = "global tool-call cap reached";
      break;
    }

    const planned = await planner.next(state);
    if (!planned) break;

    const tool = getTool(planned.tool);
    const index = state.steps.length;

    if (!tool) {
      // A planner may only call tools that exist. Unknown names are recorded
      // as failures rather than guessed at.
      state.steps.push({
        index,
        tool: planned.tool,
        args: planned.args,
        rationale: planned.rationale,
        ok: false,
        summary: `No such tool: ${planned.tool}. Available: ${TOOLS.map((t) => t.name).join(", ")}`,
        durationMs: 0,
        error: "UNKNOWN_TOOL",
      });
      continue;
    }

    // Validate BEFORE execution. A planner cannot smuggle an unvalidated
    // value (including traversal depth) into a query.
    const parsed = tool.input.safeParse(planned.args);
    if (!parsed.success) {
      state.steps.push({
        index,
        tool: tool.name,
        args: planned.args,
        rationale: planned.rationale,
        ok: false,
        summary: `Rejected arguments: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        durationMs: 0,
        error: "INVALID_ARGS",
      });
      continue;
    }

    globalCallCount += 1;
    const t0 = Date.now();
    try {
      const result = await withTimeout(
        tool.run(parsed.data, ctx),
        budget.maxToolMs,
        `tool ${tool.name}`,
      );
      state.steps.push({
        index,
        tool: tool.name,
        args: parsed.data as Record<string, unknown>,
        rationale: planned.rationale,
        ok: result.ok,
        summary: result.summary,
        durationMs: Date.now() - t0,
      });
      if (result.ok) state.results.set(tool.name, result.data);
    } catch (err) {
      state.steps.push({
        index,
        tool: tool.name,
        args: parsed.data as Record<string, unknown>,
        rationale: planned.rationale,
        ok: false,
        summary: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
        error: "TOOL_FAILED",
      });
    }
  }

  return {
    goal,
    mode: planner.mode,
    plannerLabel: planner.label,
    steps: state.steps,
    stoppedBecause,
    totalMs: Date.now() - started,
    canApprove: false,
  };
}
