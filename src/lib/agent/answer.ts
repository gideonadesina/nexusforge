import { analyseImpact } from "../engine/impact";
import { listProposals } from "../actions/actions";
import { ORGANIZATION } from "../../domain/education/seed-data";
import type { Intent, ResolvedQuestion } from "./questions";
import type { ImpactAnalysis } from "../engine/types";

/**
 * Deterministic answer composer.
 *
 * Builds an answer ONLY from graph results. Every sentence is assembled from
 * values read out of FalkorDB, so there is no path by which this can state
 * something the graph does not contain.
 *
 * This is what runs when no model is enabled, and it is also what supplies
 * the facts a model is allowed to narrate. The model never replaces it.
 */

export interface GroundedAnswer {
  intent: Intent;
  /** Plain-language answer, assembled from graph values. */
  text: string;
  /** Entity ids the answer is about, for the canvas to trace. */
  focusEntityIds: string[];
  /** Analysis backing the answer, when one was run. */
  analysis: ImpactAnalysis | null;
  /** Source ids cited by the answer. */
  citedSourceIds: string[];
  supported: boolean;
}

export async function composeAnswer(
  graphName: string,
  resolved: ResolvedQuestion,
  analysisRunId?: string,
): Promise<GroundedAnswer> {
  if (resolved.intent === "SCOPE") {
    return scopeAnswer();
  }

  if (resolved.intent === "UNSUPPORTED" || !resolved.rootEntityId) {
    return {
      intent: "UNSUPPORTED",
      text:
        `${resolved.unsupportedReason ?? "This question is not supported."} ` +
        `${resolved.clarification ?? ""}`.trim(),
      focusEntityIds: [],
      analysis: null,
      citedSourceIds: [],
      supported: false,
    };
  }

  const analysis = await analyseImpact(graphName, resolved.rootEntityId);
  const target = resolved.targetEntityId ?? undefined;

  switch (resolved.intent) {
    case "IMPACT":
      return impactAnswer(analysis);
    case "WHY_AFFECTED":
      return whyAnswer(analysis, target);
    case "EVIDENCE":
      return evidenceAnswer(analysis, target);
    case "UNKNOWNS":
      return unknownsAnswer(analysis);
    case "ACTIONS":
      return actionsAnswer(graphName, analysis, analysisRunId);
    default:
      return {
        intent: resolved.intent,
        text: "No deterministic answer is defined for this intent.",
        focusEntityIds: [],
        analysis,
        citedSourceIds: [],
        supported: false,
      };
  }
}

function scopeAnswer(): GroundedAnswer {
  return {
    intent: "SCOPE",
    text:
      `The loaded organization is ${ORGANIZATION.label} (${ORGANIZATION.sector}). ` +
      `${ORGANIZATION.notice} ` +
      `I can answer questions about this graph only: what a change exposes, why a specific ` +
      `entity is affected and by which routes, what evidence supports a finding, which findings ` +
      `have unresolved evidence, and what actions are proposed. ` +
      `I have no knowledge of any real organization's internal data.`,
    focusEntityIds: [],
    analysis: null,
    citedSourceIds: [],
    supported: true,
  };
}

function impactAnswer(a: ImpactAnalysis): GroundedAnswer {
  const direct = a.impacted.filter((e) => e.shortestPath.edgeHops === 1);
  const indirect = a.impacted.filter((e) => e.shortestPath.edgeHops > 1);
  const gaps = a.impacted.filter((e) => e.evidenceStatus !== "COMPLETE");

  const text =
    `A change to ${a.rootName} exposes ${a.distinctImpactedCount} distinct ` +
    `${a.distinctImpactedCount === 1 ? "entity" : "entities"} across ${a.totalPathCount} ` +
    `dependency ${a.totalPathCount === 1 ? "path" : "paths"} (depth bound ${a.maxDepth}). ` +
    `${direct.length} ${direct.length === 1 ? "is" : "are"} directly dependent` +
    (direct.length ? `: ${direct.map((e) => e.name).join(", ")}. ` : ". ") +
    (indirect.length
      ? `${indirect.length} ${indirect.length === 1 ? "is" : "are"} reached through ` +
        `intermediaries: ${indirect.map((e) => `${e.name} (${e.shortestPath.edgeHops} hops)`).join(", ")}. `
      : "") +
    (gaps.length
      ? `${gaps.length} ${gaps.length === 1 ? "finding has" : "findings have"} unresolved evidence and must not be acted on yet. `
      : `All cited evidence resolves. `) +
    `A dependency path proves exposure to the change, not operational failure.`;

  return {
    intent: "IMPACT",
    text,
    focusEntityIds: a.impacted.map((e) => e.entityId),
    analysis: a,
    citedSourceIds: [...new Set(a.impacted.flatMap((e) => e.evidence.map((v) => v.sourceId)))],
    supported: true,
  };
}

function whyAnswer(a: ImpactAnalysis, targetId: string | undefined): GroundedAnswer {
  const hit = targetId ? a.impacted.find((e) => e.entityId === targetId) : undefined;
  if (!hit) {
    return {
      intent: "WHY_AFFECTED",
      text:
        targetId
          ? `${targetId} is not reachable from ${a.rootName} by any dependency path within depth ${a.maxDepth}, so it is not affected.`
          : `Name which affected entity you mean. Currently exposed: ${a.impacted.map((e) => e.name).join(", ")}.`,
      focusEntityIds: [],
      analysis: a,
      citedSourceIds: [],
      supported: targetId !== undefined,
    };
  }

  const chain = hit.shortestPath.nodes.map((n) => n.id).join(" -> ");
  const text =
    `${hit.name} is affected because of this dependency chain: ${chain}. ` +
    `That is ${hit.shortestPath.edgeHops} graph ${hit.shortestPath.edgeHops === 1 ? "relationship" : "relationships"} ` +
    `and ${hit.shortestPath.entityHops} organizational ` +
    `${hit.shortestPath.entityHops === 1 ? "transition" : "transitions"}. ` +
    (hit.allPaths.length > 1
      ? `${hit.allPaths.length} independent routes reach it, so a single substitution will not resolve it. `
      : `Exactly one route reaches it. `) +
    `This conclusion is ${hit.claim}` +
    (hit.claim === "DERIVED"
      ? " — it was computed by chaining relationships, not read from a single record. "
      : " — a single evidenced relationship states it. ") +
    `Evidence is ${hit.evidenceStatus}.`;

  return {
    intent: "WHY_AFFECTED",
    text,
    focusEntityIds: [hit.entityId],
    analysis: a,
    citedSourceIds: hit.evidence.map((e) => e.sourceId),
    supported: hit.supported,
  };
}

function evidenceAnswer(a: ImpactAnalysis, targetId: string | undefined): GroundedAnswer {
  const hit = targetId ? a.impacted.find((e) => e.entityId === targetId) : undefined;
  if (!hit) {
    return {
      intent: "EVIDENCE",
      text: `Name the finding you want evidence for. Currently exposed: ${a.impacted
        .map((e) => e.name)
        .join(", ")}.`,
      focusEntityIds: [],
      analysis: a,
      citedSourceIds: [],
      supported: false,
    };
  }

  if (hit.evidence.length === 0) {
    return {
      intent: "EVIDENCE",
      text:
        `No source record resolves for ${hit.name}. Its dependency chain cites ` +
        `${hit.unresolvedSourceIds.join(", ") || "nothing"}, which ${
          hit.unresolvedSourceIds.length === 1 ? "does" : "do"
        } not exist in the graph. This finding is unsupported and must not be acted on.`,
      focusEntityIds: [hit.entityId],
      analysis: a,
      citedSourceIds: [],
      supported: false,
    };
  }

  const cited = hit.evidence
    .map((e) => `${e.reference} — "${e.excerpt}"`)
    .join(" | ");

  return {
    intent: "EVIDENCE",
    text:
      `${hit.name} is supported by ${hit.evidence.length} source ` +
      `${hit.evidence.length === 1 ? "record" : "records"}: ${cited}. ` +
      `Evidence status is ${hit.evidenceStatus}.` +
      (hit.unresolvedSourceIds.length
        ? ` Unresolved references: ${hit.unresolvedSourceIds.join(", ")}.`
        : ""),
    focusEntityIds: [hit.entityId],
    analysis: a,
    citedSourceIds: hit.evidence.map((e) => e.sourceId),
    supported: hit.supported,
  };
}

function unknownsAnswer(a: ImpactAnalysis): GroundedAnswer {
  const gaps = a.impacted.filter((e) => e.evidenceStatus !== "COMPLETE");
  if (gaps.length === 0) {
    return {
      intent: "UNKNOWNS",
      text:
        `Every dependency edge in this analysis cites a source record that exists. ` +
        `No finding has unresolved evidence. That is a statement about evidence completeness, ` +
        `not a claim that the findings are operationally correct.`,
      focusEntityIds: [],
      analysis: a,
      citedSourceIds: [],
      supported: true,
    };
  }
  return {
    intent: "UNKNOWNS",
    text:
      `${gaps.length} ${gaps.length === 1 ? "finding has" : "findings have"} unresolved evidence: ` +
      gaps
        .map(
          (g) =>
            `${g.name} (${g.evidenceStatus}; unresolved: ${g.unresolvedSourceIds.join(", ") || "n/a"})`,
        )
        .join("; ") +
      `. These must not be acted on until the gap is closed.`,
    focusEntityIds: gaps.map((g) => g.entityId),
    analysis: a,
    citedSourceIds: [],
    supported: true,
  };
}

async function actionsAnswer(
  graphName: string,
  a: ImpactAnalysis,
  analysisRunId?: string,
): Promise<GroundedAnswer> {
  const proposals = analysisRunId ? await listProposals(graphName, analysisRunId) : [];

  if (proposals.length === 0) {
    return {
      intent: "ACTIONS",
      text:
        `No proposals are stored for this question yet. Proposals are generated when an ` +
        `analysis run is persisted; run an analysis from the toolbar to create them. ` +
        `Rules fire only where the graph supports them.`,
      focusEntityIds: [],
      analysis: a,
      citedSourceIds: [],
      supported: true,
    };
  }

  const open = proposals.filter((p) => p.state === "PROPOSED");
  return {
    intent: "ACTIONS",
    text:
      `${proposals.length} ${proposals.length === 1 ? "action is" : "actions are"} proposed: ` +
      proposals.map((p) => `${p.actionType} on ${p.targetEntityName} [${p.state}]`).join("; ") +
      `. ${open.length} await a decision. Approval is recorded by the holder of this run's owner ` +
      `token and is explicitly NOT execution — NexusForge performs no external action.`,
    focusEntityIds: proposals.map((p) => p.targetEntityId),
    analysis: a,
    citedSourceIds: [],
    supported: true,
  };
}
