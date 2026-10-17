import { z } from "zod";
import { roQuery } from "../falkor/client";
import { analyseImpact } from "../engine/impact";
import { listProposals } from "../actions/actions";
import { DepthSchema } from "../graph/depth";

/**
 * The agent's tool surface.
 *
 * Three hard constraints, all enforced here rather than by prompting:
 *
 * 1. NO ARBITRARY CYPHER. Every tool runs a fixed template. There is no tool
 *    that accepts a query string, so an agent cannot compose one.
 * 2. NO AUTHORITY. There is deliberately no approve/reject tool. An agent can
 *    investigate and recommend; only a human holding the run's owner token can
 *    record a decision. This is the "never bypass authorization" rule made
 *    structural.
 * 3. EVERY INPUT IS ZOD-VALIDATED before it reaches the database, including
 *    traversal depth, which is the one value interpolated into Cypher.
 * 4. NO TOOL WRITES. Every tool here is read-only and must stay that way.
 *
 * On (4): these tools previously called `ensureSeeded(ctx.graphName)` with no
 * domain pack, so the EDUCATION pack was used by default. Against a correctly
 * seeded Northstar graph the education version check fails, and a read
 * operation would have seeded education data into Northstar's graph. Seeding
 * has been removed from the tool surface entirely -- a read tool must never
 * write, and initialization is the caller's explicit responsibility with an
 * explicit pack. `tests/agent-tools-readonly.test.ts` enforces this.
 */

export interface ToolContext {
  graphName: string;
  /** Run created by the agent during this session, if any. */
  analysisRunId?: string;
}

export interface ToolResult {
  ok: boolean;
  /** Compact, model-readable summary. */
  summary: string;
  /** Structured payload for the UI. */
  data: unknown;
}

export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  input: S;
  /** True when the tool writes. Used by the budget guard. */
  mutates: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}

/* ---------------------------------------------------------------- */

const listEntities: AgentTool = {
  name: "list_entities",
  description:
    "List entities in the organizational graph with how many things depend on each. " +
    "Use this to choose which entity to analyse.",
  input: z.object({
    minDependents: z.number().int().min(0).max(100).optional(),
  }),
  mutates: false,
  async run(args, ctx) {
    const min = (args as { minDependents?: number }).minDependents ?? 0;
    const res = await roQuery<{ id: string; type: string; name: string; dependentCount: number }>(
      ctx.graphName,
      `
MATCH (e:Entity)
OPTIONAL MATCH (d:Entity)-[:DEPENDS_ON]->(e)
WITH e, count(d) AS dependentCount
WHERE dependentCount >= $min
RETURN e.id AS id, e.type AS type, e.name AS name, dependentCount AS dependentCount
ORDER BY dependentCount DESC, id
`.trim(),
      { params: { min } },
    );
    return {
      ok: true,
      summary:
        `${res.data.length} entities with >= ${min} dependents. ` +
        res.data
          .slice(0, 5)
          .map((e) => `${e.id} (${e.type}, ${e.dependentCount} dependents)`)
          .join("; "),
      data: res.data,
    };
  },
};

const analyseImpactTool: AgentTool = {
  name: "analyse_impact",
  description:
    "Run a bounded multi-hop dependency traversal from a changed entity. " +
    "Returns every exposed entity with its claim class and evidence status.",
  input: z.object({
    rootEntityId: z.string().min(1),
    maxDepth: DepthSchema.optional(),
  }),
  mutates: false,
  async run(args, ctx) {
    const a = args as { rootEntityId: string; maxDepth?: number };
    const analysis = await analyseImpact(ctx.graphName, a.rootEntityId, {
      ...(a.maxDepth !== undefined ? { maxDepth: a.maxDepth } : {}),
    });
    const observed = analysis.impacted.filter((e) => e.claim === "OBSERVED").length;
    const unsupported = analysis.impacted.filter((e) => !e.supported).length;
    // The summary is the only part a model planner sees, so it has to carry
    // the entity ids. Reporting counts alone left the model unable to call
    // explain_path or get_evidence, because it had no id to pass: in a paid
    // run it correctly refused to invent one and stopped two tools in. A
    // scripted planner never hit this, since it reads the structured result.
    const roster = analysis.impacted
      .map(
        (e) =>
          `${e.entityId} (${e.shortestPath.edgeHops} hop${e.shortestPath.edgeHops === 1 ? "" : "s"}, ` +
          `${e.claim}, evidence ${e.evidenceStatus}${e.supported ? "" : ", UNSUPPORTED"})`,
      )
      .join("; ");

    return {
      ok: true,
      summary:
        `${analysis.distinctImpactedCount} distinct exposed entities via ` +
        `${analysis.totalPathCount} paths (depth <= ${analysis.maxDepth}). ` +
        `${observed} OBSERVED, ${analysis.impacted.length - observed} DERIVED. ` +
        `${unsupported} with unresolved evidence. ` +
        `Exposed entities: ${roster}.`,
      data: analysis,
    };
  },
};

const explainPath: AgentTool = {
  name: "explain_path",
  description:
    "Show the exact dependency chain from one affected entity back to the changed entity, " +
    "including the relationship ids traversed.",
  input: z.object({
    rootEntityId: z.string().min(1),
    entityId: z.string().min(1),
    maxDepth: DepthSchema.optional(),
  }),
  mutates: false,
  async run(args, ctx) {
    const a = args as { rootEntityId: string; entityId: string; maxDepth?: number };
    const analysis = await analyseImpact(ctx.graphName, a.rootEntityId, {
      ...(a.maxDepth !== undefined ? { maxDepth: a.maxDepth } : {}),
    });
    const hit = analysis.impacted.find((e) => e.entityId === a.entityId);
    if (!hit) {
      return {
        ok: false,
        summary: `${a.entityId} is NOT reachable from ${a.rootEntityId} by any dependency path within the bound. It is not affected.`,
        data: null,
      };
    }
    return {
      ok: true,
      summary:
        `${a.entityId}: ${hit.claim}, evidence ${hit.evidenceStatus}. ` +
        `Shortest route ${hit.shortestPath.nodes.map((n) => n.id).join(" -> ")} ` +
        `(${hit.shortestPath.edgeHops} edge hops, ${hit.shortestPath.entityHops} entity hops). ` +
        `${hit.allPaths.length} distinct route(s).`,
      data: hit,
    };
  },
};

const getEvidence: AgentTool = {
  name: "get_evidence",
  description:
    "Fetch the verbatim source records supporting a conclusion about an entity. " +
    "Use this before asserting anything as fact.",
  input: z.object({
    rootEntityId: z.string().min(1),
    entityId: z.string().min(1),
  }),
  mutates: false,
  async run(args, ctx) {
    const a = args as { rootEntityId: string; entityId: string };
    const analysis = await analyseImpact(ctx.graphName, a.rootEntityId);
    const hit = analysis.impacted.find((e) => e.entityId === a.entityId);
    if (!hit) {
      return { ok: false, summary: `No finding for ${a.entityId}.`, data: null };
    }
    return {
      ok: true,
      summary:
        hit.evidence.length === 0
          ? `No evidence resolved for ${a.entityId}. Treat as unsupported.`
          : `${hit.evidence.length} source(s): ` +
            hit.evidence.map((e) => `${e.sourceId} (${e.sourceType})`).join("; ") +
            (hit.unresolvedSourceIds.length
              ? `. UNRESOLVED: ${hit.unresolvedSourceIds.join(", ")}`
              : ""),
      data: { evidence: hit.evidence, unresolved: hit.unresolvedSourceIds },
    };
  },
};

const listProposalsTool: AgentTool = {
  name: "list_proposals",
  description:
    "List action proposals for an analysis run. The agent may read and explain these " +
    "but cannot approve or reject them.",
  input: z.object({ analysisRunId: z.string().min(1) }),
  mutates: false,
  async run(args, ctx) {
    const a = args as { analysisRunId: string };
    const proposals = await listProposals(ctx.graphName, a.analysisRunId);
    return {
      ok: true,
      summary:
        `${proposals.length} proposal(s): ` +
        proposals.map((p) => `${p.actionType} on ${p.targetEntityId} [${p.state}]`).join("; "),
      data: proposals,
    };
  },
};

export const TOOLS: AgentTool[] = [
  listEntities,
  analyseImpactTool,
  explainPath,
  getEvidence,
  listProposalsTool,
];

export function getTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Tool catalogue in the shape a model needs for structured tool calling.
 * Generated from the same Zod schemas the executor validates against, so the
 * advertised contract and the enforced contract cannot drift.
 */
export function toolCatalogue(): Array<{
  name: string;
  description: string;
  input_schema: unknown;
}> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input),
  }));
}
