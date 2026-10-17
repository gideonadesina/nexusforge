import {
  DEFAULT_TRAVERSAL_DEPTH,
  MIN_TRAVERSAL_DEPTH,
  MAX_TRAVERSAL_DEPTH,
} from "@/lib/graph/depth";

/**
 * Reading what an Ask response actually computed.
 *
 * A transcript step's `args` are the Zod-validated arguments the tool really
 * ran with. That record -- never the model's prose -- is the only thing the
 * view may use to decide what to draw, so the canvas cannot be talked into
 * rendering a traversal that did not happen.
 *
 * Lives outside AskPanel so it is a plain module the node test suite can
 * import directly, the same arrangement as graph-edges.ts.
 *
 * Depth constants come from lib/graph/depth, which depends on nothing but
 * zod. The engine's own default lives in lib/engine/impact, but that module
 * reaches the FalkorDB client transitively and importing it here puts the
 * driver in the browser bundle and fails the build. The two defaults are
 * pinned equal by tests/ask-canvas-depth.test.ts instead.
 */

export interface AgentStep {
  index: number;
  tool: string;
  /** The validated arguments the planner actually passed to the tool. */
  args: Record<string, unknown>;
  rationale: string;
  summary: string;
  durationMs: number;
  ok: boolean;
}

export interface AgentRun {
  mode: string;
  plannerLabel: string;
  steps: AgentStep[];
  stoppedBecause: string;
  finalText?: string | null;
}

/**
 * The depth bound the agent's own traversal ran under, if it ran one.
 *
 * `analyse_impact` makes maxDepth optional, and analyseImpact then applies
 * the default, so an omitted argument still describes a real traversal at
 * that depth rather than an unknown one. A recorded value outside the
 * engine's accepted range is ignored instead of trusted: it cannot be a
 * bound any traversal completed under.
 */
function agentTraversalDepth(agent: AgentRun | null | undefined): number | undefined {
  const step = agent?.steps?.find((s) => s.tool === "analyse_impact" && s.ok);
  if (!step) return undefined;

  const recorded = step.args?.maxDepth;
  if (recorded === undefined) return DEFAULT_TRAVERSAL_DEPTH;

  return typeof recorded === "number" &&
    Number.isInteger(recorded) &&
    recorded >= MIN_TRAVERSAL_DEPTH &&
    recorded <= MAX_TRAVERSAL_DEPTH
    ? recorded
    : undefined;
}

/**
 * The depth the canvas must draw to show everything the sidebar claims.
 *
 * Two traversals can sit behind one Ask response, and the canvas has to be
 * consistent with both:
 *
 *  - the grounded answer, which composeAnswer always computes at the default
 *    depth and whose text states that bound out loud. Drawing anything
 *    shallower would put a canvas on screen that contradicts the sentence
 *    beside it, and drawing whatever the user last left in the depth input
 *    would be a bound nothing was computed under.
 *  - the model's own traversal, when one ran, which may go deeper.
 *
 * So the bound is the deeper of the two: every entity either answer can
 * mention is then present on the canvas, and neither is contradicted. A
 * shallower model traversal does not narrow the canvas, because the grounded
 * answer it sits beside is still the authoritative text.
 */
export function answeredDepth(agent: AgentRun | null | undefined): number {
  return Math.max(DEFAULT_TRAVERSAL_DEPTH, agentTraversalDepth(agent) ?? DEFAULT_TRAVERSAL_DEPTH);
}
