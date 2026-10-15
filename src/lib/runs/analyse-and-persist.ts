import { analyseImpact } from "../engine/impact";
import { createAnalysisRun, persistFindings } from "./persist";
import type { RunCredentials } from "./authz";
import type { ImpactAnalysis } from "../engine/types";
import type { CreatedRun } from "./types";
import { parseDepth } from "../graph/depth";

/**
 * Orchestration: compute an impact analysis with the graph-backed engine and
 * persist it as a durable run.
 *
 * The findings written here are ALWAYS the output of `analyseImpact`, which
 * reads the real graph. Nothing is reconstructed from a prewritten answer, and
 * there is no path through this module that fabricates a finding.
 */

export interface RunAndPersistResult {
  run: CreatedRun;
  analysis: ImpactAnalysis;
  findingsWritten: number;
  persistAttempts: number;
}

/**
 * Start a NEW analysis: mints a fresh run id and owner token.
 *
 * Depth is validated before anything else happens, so an invalid depth can
 * never reach query construction or create a half-formed run.
 */
export async function runAndPersistAnalysis(
  graphName: string,
  rootEntityId: string,
  options: { maxDepth?: number } = {},
): Promise<RunAndPersistResult> {
  const maxDepth = parseDepth(options.maxDepth);

  // Compute first. A run is only created once we have a real result, so a
  // failed traversal cannot leave an orphaned PENDING run behind.
  const analysis = await analyseImpact(graphName, rootEntityId, { maxDepth });

  const run = await createAnalysisRun(graphName, {
    rootEntityId: analysis.rootEntityId,
    rootEntityType: analysis.rootEntityType,
    rootName: analysis.rootName,
    maxDepth: analysis.maxDepth,
    ruleId: analysis.ruleId,
  });

  const result = await persistFindings(
    graphName,
    { analysisRunId: run.analysisRunId, ownerToken: run.ownerToken },
    analysis,
  );

  return {
    run,
    analysis,
    findingsWritten: result.findingsWritten,
    persistAttempts: result.persistAttempts,
  };
}

/**
 * RETRY persistence for an EXISTING run, using credentials the caller already
 * holds. Distinct from `runAndPersistAnalysis`, which always creates a new run
 * -- that distinction is what keeps "new analysis" and "retry" separable.
 *
 * Recomputes from the graph rather than trusting a cached result, then writes
 * idempotently over the same deterministic finding ids.
 */
export async function retryPersistAnalysis(
  graphName: string,
  creds: RunCredentials,
  rootEntityId: string,
  options: { maxDepth?: number } = {},
): Promise<{ analysis: ImpactAnalysis; findingsWritten: number; persistAttempts: number }> {
  const maxDepth = parseDepth(options.maxDepth);
  const analysis = await analyseImpact(graphName, rootEntityId, { maxDepth });
  const result = await persistFindings(graphName, creds, analysis);
  return {
    analysis,
    findingsWritten: result.findingsWritten,
    persistAttempts: result.persistAttempts,
  };
}
