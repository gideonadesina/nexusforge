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
export function scriptedPlanner(
  rootEntityId: string,
  /**
   * Must match the loop's budget. The planner stops interrogating one step
   * early so the investigation ends with a conclusion rather than running out
   * of road, which is what it used to do.
   */
  maxSteps = 8,
): Planner & { finalText: () => string | null } {
  let summary: string | null = null;

  return {
    mode: "scripted",
    label: "Scripted procedure (deterministic, not a language model)",
    finalText: () => summary,

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

      if (!lastAnalysis) {
        summary = composeScriptedSummary(state, null);
        return null;
      }

      // Leave room to conclude.
      if (state.steps.length >= maxSteps - 1) {
        summary = composeScriptedSummary(state, findAnalysis(state));
        return null;
      }

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

      summary = composeScriptedSummary(state, analysis);
      return null;
    },
  };
}

/**
 * Compose the closing answer from what the tools actually returned.
 *
 * Every number and name here is read out of a recorded tool result. Nothing
 * is restated from the question, and nothing is inferred beyond the counts
 * the traversal produced. If an analysis never ran, that is said plainly
 * instead of producing a confident-sounding empty answer.
 */
function composeScriptedSummary(
  state: LoopState,
  analysis: MinimalAnalysis | null,
): string {
  if (!analysis) {
    return (
      "No dependency analysis completed, so there is nothing to report. " +
      "This is a gap in the investigation, not a finding that the change is safe."
    );
  }

  const direct = analysis.impacted.filter((e) => e.shortestPath.edgeHops === 1);
  const indirect = analysis.impacted.filter((e) => e.shortestPath.edgeHops > 1);
  const unsupported = analysis.impacted.filter((e) => !e.supported);
  const observed = analysis.impacted.filter((e) => e.claim === "OBSERVED");

  // The most distant exposure is the one a one-hop check would miss.
  const furthest = [...analysis.impacted].sort(
    (a, b) => b.shortestPath.edgeHops - a.shortestPath.edgeHops,
  )[0];

  const examined = [
    ...new Set(
      state.steps
        .filter((s) => s.ok && (s.tool === "explain_path" || s.tool === "get_evidence"))
        .map((s) => String(s.args.entityId ?? ""))
        .filter(Boolean),
    ),
  ];

  const unresolved = [
    ...new Set(analysis.impacted.flatMap((e) => e.unresolvedSourceIds ?? [])),
  ];

  const parts: string[] = [];

  parts.push(
    `A change to ${analysis.rootName} exposes ${analysis.distinctImpactedCount} distinct ` +
      `entities across ${analysis.totalPathCount} dependency paths, within a depth bound of ` +
      `${analysis.maxDepth}. ${direct.length} depend on it directly; ${indirect.length} are ` +
      `reached only through intermediaries.`,
  );

  if (furthest && furthest.shortestPath.edgeHops > 1) {
    parts.push(
      `The most distant exposure is ${furthest.name} at ${furthest.shortestPath.edgeHops} ` +
        `relationships. A direct dependency check would not have found it.`,
    );
  }

  parts.push(
    `${observed.length} findings are OBSERVED, meaning a single relationship backed by ` +
      `evidence that resolves. The remaining ${analysis.impacted.length - observed.length} are ` +
      `DERIVED: computed by chaining relationships, so no single record states them.`,
  );

  if (unsupported.length > 0) {
    parts.push(
      `${unsupported.length} findings are NOT supported by resolvable evidence: ` +
        `${unsupported.map((e) => `${e.name} (${e.evidenceStatus})`).join("; ")}. ` +
        `These must not be acted on until the gap is closed.`,
    );
  } else {
    parts.push("Every cited source resolves, so no finding is unsupported.");
  }

  if (unresolved.length > 0) {
    parts.push(`Unresolved references: ${unresolved.join(", ")}.`);
  }

  if (examined.length > 0) {
    parts.push(`Paths and evidence were inspected directly for: ${examined.join(", ")}.`);
  }

  parts.push(
    "Limitations: a dependency path proves exposure to the change, not operational " +
      "failure. No severity was assigned, no replacement owner was inferred, and nothing " +
      "here has been executed. Any action requires a human decision.",
  );

  return parts.join(" ");
}

interface RankedTarget {
  entityId: string;
  reason: string;
}

interface MinimalAnalysis {
  rootName: string;
  distinctImpactedCount: number;
  totalPathCount: number;
  maxDepth: number;
  impacted: Array<{
    entityId: string;
    name: string;
    claim: string;
    supported: boolean;
    evidenceStatus: string;
    unresolvedSourceIds: string[];
    allPaths: unknown[];
    shortestPath: { edgeHops: number; entityHops: number };
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

/**
 * True when a model planner could actually run right now.
 *
 * This previously returned a hardcoded false, left over from before the
 * OpenAI planner existed, so the capability probe understated what was
 * available. It now reflects the two real gates: a key must be present AND
 * NF_AGENT_LLM must be switched on. A key alone is deliberately not enough.
 */
export function llmConfigured(): boolean {
  const hasKey =
    typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
  const enabled = (process.env.NF_AGENT_LLM ?? "off").toLowerCase() === "on";
  return hasKey && enabled;
}
