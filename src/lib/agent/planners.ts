import type { Planner, PlannedCall, LoopState } from "./loop";

/**
 * Planners.
 *
 * The scripted planner is NOT a model and must never be described as one. It
 * follows a fixed investigation procedure. Its honesty label travels with the
 * result (`mode: "scripted"`), and the UI renders it as "scripted procedure".
 *
 * The LLM planner is the seam for a real model. No provider is configured in
 * this project, so it reports that plainly instead of pretending.
 */

/**
 * A fixed investigation procedure: establish the graph, trace impact, then
 * interrogate the most interesting findings for evidence.
 *
 * It is deterministic (the same graph produces the same transcript), which
 * makes it demonstrable and testable, but it is not reasoning.
 */
export function scriptedPlanner(rootEntityId: string): Planner {
  return {
    mode: "scripted",
    label: "Scripted procedure (deterministic, not a language model)",

    async next(state: LoopState): Promise<PlannedCall | null> {
      const done = new Set(state.steps.map((s) => s.tool));
      const lastAnalysis = state.steps.find((s) => s.tool === "analyse_impact" && s.ok);

      // 1. Survey the graph.
      if (!done.has("list_entities")) {
        return {
          tool: "list_entities",
          args: { minDependents: 1 },
          rationale:
            "Establish what the graph actually contains before asserting anything about it.",
        };
      }

      // 2. Trace impact from the entity under investigation.
      if (!done.has("analyse_impact")) {
        return {
          tool: "analyse_impact",
          args: { rootEntityId, maxDepth: 6 },
          rationale:
            "Run the bounded dependency traversal. Exposure is computed from the graph, never assumed.",
        };
      }

      if (!lastAnalysis) return null;

      // 3. Interrogate findings, hardest cases first: anything unsupported,
      //    then multi-route entities, then the most distant.
      const analysis = findAnalysis(state);
      if (!analysis) return null;

      const targets = rankTargets(analysis);
      const explained = new Set(
        state.steps
          .filter((s) => s.tool === "explain_path")
          .map((s) => String(s.args.entityId)),
      );
      const evidenced = new Set(
        state.steps
          .filter((s) => s.tool === "get_evidence")
          .map((s) => String(s.args.entityId)),
      );

      for (const t of targets) {
        if (!explained.has(t.entityId)) {
          return {
            tool: "explain_path",
            args: { rootEntityId, entityId: t.entityId, maxDepth: 6 },
            rationale: t.reason,
          };
        }
        if (!evidenced.has(t.entityId)) {
          return {
            tool: "get_evidence",
            args: { rootEntityId, entityId: t.entityId },
            rationale: `Check the source records behind ${t.entityId} before treating it as established.`,
          };
        }
      }

      return null;
    },
  };
}

interface RankedTarget {
  entityId: string;
  reason: string;
}

interface MinimalAnalysis {
  impacted: Array<{
    entityId: string;
    supported: boolean;
    evidenceStatus: string;
    allPaths: unknown[];
    shortestPath: { edgeHops: number };
  }>;
}

function findAnalysis(state: LoopState): MinimalAnalysis | null {
  return (state.results.get("analyse_impact") as MinimalAnalysis | undefined) ?? null;
}

/** Hardest-first: unsupported, then multi-route, then most distant. */
function rankTargets(analysis: MinimalAnalysis): RankedTarget[] {
  const out: RankedTarget[] = [];
  for (const e of analysis.impacted) {
    if (!e.supported) {
      out.push({
        entityId: e.entityId,
        reason: `Evidence for ${e.entityId} is ${e.evidenceStatus}. Trace it before relying on it.`,
      });
    }
  }
  for (const e of analysis.impacted) {
    if (e.supported && e.allPaths.length > 1) {
      out.push({
        entityId: e.entityId,
        reason: `${e.entityId} is reached by ${e.allPaths.length} distinct routes; confirm what they share.`,
      });
    }
  }
  const furthest = [...analysis.impacted]
    .filter((e) => e.supported && e.allPaths.length === 1)
    .sort((a, b) => b.shortestPath.edgeHops - a.shortestPath.edgeHops)[0];
  if (furthest) {
    out.push({
      entityId: furthest.entityId,
      reason: `${furthest.entityId} is the most distant exposure; confirm the chain holds end to end.`,
    });
  }
  return out.slice(0, 3);
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "No language model is configured. Set an LLM provider key to enable the model planner. " +
        "The scripted planner runs without one.",
    );
    this.name = "LlmNotConfiguredError";
  }
}

/** True when a model planner could run. No provider is wired in this project. */
export function llmConfigured(): boolean {
  return false;
}
