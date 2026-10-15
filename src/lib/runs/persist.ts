import { randomUUID } from "node:crypto";
import { roQuery, writeQuery } from "../falkor/client";
import {
  withRunAuthorization,
  generateOwnerToken,
  hashOwnerToken,
  type RunCredentials,
} from "./authz";
import type {
  AnalysisRunRecord,
  CreatedRun,
  FindingRecord,
  RunStatus,
  VerificationStatus,
} from "./types";
import type { ImpactAnalysis } from "../engine/types";
import { SEED_VERSION } from "../graph/seed";

/**
 * Persistence of analysis runs and findings in FalkorDB.
 *
 * Separation of concerns (requirement 5): the organizational seed
 * (`:Entity`, `:Source`, `:DEPENDS_ON`, `:EVIDENCED_BY`) is never written
 * here. This module only creates `:AnalysisRun` and `:Finding` nodes and the
 * edges that hang off them. Organizational nodes are read, never modified.
 */

/** Default verification status for a newly persisted finding. */
const INITIAL_VERIFICATION: VerificationStatus = "UNVERIFIED";

/** Deterministic finding id, so re-persisting a run cannot duplicate rows. */
export function findingIdFor(analysisRunId: string, entityId: string): string {
  return `${analysisRunId}::${entityId}`;
}

/** Indexes supporting run lookups. Safe to call repeatedly. */
export async function ensureRunIndexes(graphName: string): Promise<void> {
  const statements = [
    `CREATE INDEX FOR (n:AnalysisRun) ON (n.analysisRunId)`,
    `CREATE INDEX FOR (n:Finding) ON (n.findingId)`,
    `CREATE INDEX FOR (n:Finding) ON (n.analysisRunId)`,
  ];
  for (const stmt of statements) {
    try {
      await writeQuery(graphName, stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already indexed|already exists/i.test(msg)) throw err;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pathway 1: run creation (mints a credential; requires none)
 * ------------------------------------------------------------------ */

export interface CreateRunInput {
  rootEntityId: string;
  rootEntityType: string;
  rootName: string;
  maxDepth: number;
  ruleId: string;
}

/**
 * Create a new analysis run and mint its owner token.
 *
 * This is the ONLY pathway that does not require an existing credential --
 * necessarily, because it is what issues one. Every later mutation of this run
 * must go through `withRunAuthorization`.
 *
 * The returned `ownerToken` is the single plaintext copy that will ever exist.
 * Only its hash reaches the database.
 */
export async function createAnalysisRun(
  graphName: string,
  input: CreateRunInput,
): Promise<CreatedRun> {
  await ensureRunIndexes(graphName);

  const analysisRunId = randomUUID();
  const ownerToken = generateOwnerToken();
  const now = new Date().toISOString();

  await writeQuery(
    graphName,
    `
CREATE (r:AnalysisRun {
  analysisRunId:         $analysisRunId,
  rootEntityId:          $rootEntityId,
  rootEntityType:        $rootEntityType,
  rootName:              $rootName,
  maxDepth:              $maxDepth,
  status:                $status,
  ruleId:                $ruleId,
  seedVersion:           $seedVersion,
  graphName:             $graphName,
  createdAt:             $now,
  updatedAt:             $now,
  distinctImpactedCount: 0,
  totalPathCount:        0,
  persistAttempts:       0,
  ownerTokenHash:        $ownerTokenHash,
  synthetic:             true
})
RETURN r.analysisRunId AS id
`.trim(),
    {
      params: {
        analysisRunId,
        rootEntityId: input.rootEntityId,
        rootEntityType: input.rootEntityType,
        rootName: input.rootName,
        maxDepth: input.maxDepth,
        status: "PENDING" satisfies RunStatus,
        ruleId: input.ruleId,
        seedVersion: SEED_VERSION,
        graphName,
        now,
        ownerTokenHash: hashOwnerToken(ownerToken),
      },
    },
  );

  return { analysisRunId, ownerToken };
}

/* ------------------------------------------------------------------ *
 * Pathway 2: authorized mutation of an existing run
 * ------------------------------------------------------------------ */

export interface PersistResult {
  findingsWritten: number;
  persistAttempts: number;
  /** True when this call was a retry of an already-persisted run. */
  isRetry: boolean;
}

/** Flatten an ImpactAnalysis into the row shape written to the graph. */
function toFindingRows(
  analysisRunId: string,
  analysis: ImpactAnalysis,
  now: string,
): Array<Record<string, unknown>> {
  return analysis.impacted.map((e) => ({
    findingId: findingIdFor(analysisRunId, e.entityId),
    entityId: e.entityId,
    entityType: e.entityType,
    entityName: e.name,
    claim: e.claim,
    ruleId: e.ruleId,
    verificationStatus: INITIAL_VERIFICATION,
    shortestPathEntityIds: e.shortestPath.nodes.map((n) => n.id),
    shortestPathRelationshipIds: e.shortestPath.relationshipIds,
    edgeHops: e.shortestPath.edgeHops,
    entityHops: e.shortestPath.entityHops,
    pathCount: e.allPaths.length,
    allPathSignatures: e.allPaths.map((p) => p.nodes.map((n) => n.id).join(">")),
    evidenceSourceIds: e.evidence.map((ev) => ev.sourceId),
    createdAt: now,
  }));
}

/**
 * Persist the findings of an analysis against an existing run.
 *
 * Idempotent: findings are MERGEd on a deterministic `findingId`, so calling
 * this twice with the same run id and the same analysis converges on the same
 * graph. `persistAttempts` still increments, which is how a retry is
 * distinguished from a first write.
 *
 * Authorization is enforced inside the mutating statement.
 */
export async function persistFindings(
  graphName: string,
  creds: RunCredentials,
  analysis: ImpactAnalysis,
): Promise<PersistResult> {
  const now = new Date().toISOString();
  const rows = toFindingRows(creds.analysisRunId, analysis, now);

  // Findings + their link to the run and to the affected entity.
  // An empty analysis still needs the run marked COMPLETED, so the two cases
  // are handled by different statements rather than by an UNWIND over [].
  if (rows.length > 0) {
    await withRunAuthorization(
      graphName,
      creds,
      `
UNWIND $rows AS row
MERGE (fd:Finding {findingId: row.findingId})
SET fd.analysisRunId        = $runId,
    fd.entityId             = row.entityId,
    fd.entityType           = row.entityType,
    fd.entityName           = row.entityName,
    fd.claim                = row.claim,
    fd.ruleId               = row.ruleId,
    fd.verificationStatus   = row.verificationStatus,
    fd.shortestPathEntityIds        = row.shortestPathEntityIds,
    fd.shortestPathRelationshipIds  = row.shortestPathRelationshipIds,
    fd.edgeHops             = row.edgeHops,
    fd.entityHops           = row.entityHops,
    fd.pathCount            = row.pathCount,
    fd.allPathSignatures    = row.allPathSignatures,
    fd.evidenceSourceIds    = row.evidenceSourceIds,
    fd.createdAt            = coalesce(fd.createdAt, row.createdAt),
    fd.updatedAt            = row.createdAt,
    fd.synthetic            = true
MERGE (fd)-[:PART_OF_RUN]->(run)
WITH run, collect(fd) AS findings
RETURN size(findings) AS findingsWritten
`,
      ``,
      { rows },
    );

    // Graph-native provenance edges, in a separate idempotent statement so a
    // failure here cannot leave the finding rows half-written.
    await withRunAuthorization(
      graphName,
      creds,
      `
UNWIND $rows AS row
MATCH (fd:Finding {findingId: row.findingId})
MATCH (e:Entity {id: row.entityId})
MERGE (fd)-[:ABOUT]->(e)
WITH run, collect(fd) AS linked
RETURN size(linked) AS aboutLinked
`,
      ``,
      { rows },
    );

    const evidenceRows = rows.flatMap((r) =>
      (r.evidenceSourceIds as string[]).map((sourceId) => ({
        findingId: r.findingId as string,
        sourceId,
      })),
    );
    if (evidenceRows.length > 0) {
      await withRunAuthorization(
        graphName,
        creds,
        `
UNWIND $evidenceRows AS row
MATCH (fd:Finding {findingId: row.findingId})
MATCH (s:Source {id: row.sourceId})
MERGE (fd)-[:CITES]->(s)
WITH run, collect(fd) AS cited
RETURN size(cited) AS citesLinked
`,
        ``,
        { evidenceRows },
      );
    }
  }

  // Finalise the run. persistAttempts increments on every call, including
  // retries, which is what makes a retry distinguishable.
  const final = await withRunAuthorization<{
    persistAttempts: number;
    findingsWritten: number;
  }>(
    graphName,
    creds,
    `
SET run.status                = $status,
    run.updatedAt             = $now,
    run.distinctImpactedCount = $distinctImpactedCount,
    run.totalPathCount        = $totalPathCount,
    run.persistAttempts       = coalesce(run.persistAttempts, 0) + 1
WITH run
OPTIONAL MATCH (f:Finding)-[:PART_OF_RUN]->(run)
WITH run, count(f) AS findingsWritten
`,
    `RETURN run.persistAttempts AS persistAttempts, findingsWritten AS findingsWritten`,
    {
      status: "COMPLETED" satisfies RunStatus,
      now,
      distinctImpactedCount: analysis.distinctImpactedCount,
      totalPathCount: analysis.totalPathCount,
    },
  );

  const persistAttempts = final[0]?.persistAttempts ?? 0;
  return {
    findingsWritten: final[0]?.findingsWritten ?? 0,
    persistAttempts,
    isRetry: persistAttempts > 1,
  };
}

/* ------------------------------------------------------------------ *
 * Reads. No token required, but the token hash is NEVER returned.
 * ------------------------------------------------------------------ */

/**
 * Columns returned for a run. `ownerTokenHash` is deliberately absent and must
 * never be added: it must not reach an API response, a visualization, a log,
 * or an LLM tool result.
 */
const RUN_COLUMNS = `
  r.analysisRunId         AS analysisRunId,
  r.rootEntityId          AS rootEntityId,
  r.rootEntityType        AS rootEntityType,
  r.rootName              AS rootName,
  r.maxDepth              AS maxDepth,
  r.status                AS status,
  r.ruleId                AS ruleId,
  r.seedVersion           AS seedVersion,
  r.graphName             AS graphName,
  r.createdAt             AS createdAt,
  r.updatedAt             AS updatedAt,
  r.distinctImpactedCount AS distinctImpactedCount,
  r.totalPathCount        AS totalPathCount,
  r.persistAttempts       AS persistAttempts
`.trim();

export async function getRun(
  graphName: string,
  analysisRunId: string,
): Promise<AnalysisRunRecord | null> {
  const res = await roQuery<AnalysisRunRecord>(
    graphName,
    `MATCH (r:AnalysisRun {analysisRunId: $id}) RETURN ${RUN_COLUMNS}`,
    { params: { id: analysisRunId } },
  );
  return res.data[0] ?? null;
}

export async function listRuns(graphName: string): Promise<AnalysisRunRecord[]> {
  const res = await roQuery<AnalysisRunRecord>(
    graphName,
    `MATCH (r:AnalysisRun) RETURN ${RUN_COLUMNS} ORDER BY createdAt DESC`,
  );
  return res.data;
}

export async function listFindings(
  graphName: string,
  analysisRunId: string,
): Promise<FindingRecord[]> {
  const res = await roQuery<FindingRecord>(
    graphName,
    `
MATCH (f:Finding)-[:PART_OF_RUN]->(r:AnalysisRun {analysisRunId: $id})
RETURN f.findingId                     AS findingId,
       f.analysisRunId                 AS analysisRunId,
       f.entityId                      AS entityId,
       f.entityType                    AS entityType,
       f.entityName                    AS entityName,
       f.claim                         AS claim,
       f.ruleId                        AS ruleId,
       f.verificationStatus            AS verificationStatus,
       f.shortestPathEntityIds         AS shortestPathEntityIds,
       f.shortestPathRelationshipIds   AS shortestPathRelationshipIds,
       f.edgeHops                      AS edgeHops,
       f.entityHops                    AS entityHops,
       f.pathCount                     AS pathCount,
       f.allPathSignatures             AS allPathSignatures,
       f.evidenceSourceIds             AS evidenceSourceIds,
       f.createdAt                     AS createdAt
ORDER BY entityId
`.trim(),
    { params: { id: analysisRunId } },
  );
  return res.data;
}

/* ------------------------------------------------------------------ *
 * Pathway 3: administrative maintenance (explicitly separate)
 * ------------------------------------------------------------------ */

/**
 * Delete a run and its findings WITHOUT an owner token.
 *
 * This deliberately bypasses run ownership and exists only for operator-driven
 * cleanup of old synthetic demo runs on the 100 MB free tier. It is not
 * reachable from any request path -- there is no HTTP surface in this project
 * yet, and when one is added this function must stay behind an operator-only
 * boundary.
 *
 * It never touches organizational data: only :AnalysisRun and :Finding nodes.
 */
export async function adminDeleteRun(
  graphName: string,
  analysisRunId: string,
  options: { iUnderstandThisBypassesOwnership: true; reason: string },
): Promise<{ deletedFindings: number }> {
  if (options?.iUnderstandThisBypassesOwnership !== true) {
    throw new Error("adminDeleteRun requires explicit acknowledgement of ownership bypass.");
  }
  if (!options.reason || options.reason.trim().length === 0) {
    throw new Error("adminDeleteRun requires a non-empty reason for the audit trail.");
  }

  const res = await writeQuery<{ deleted: number }>(
    graphName,
    `
MATCH (r:AnalysisRun {analysisRunId: $id})
OPTIONAL MATCH (f:Finding)-[:PART_OF_RUN]->(r)
WITH r, collect(f) AS fs
FOREACH (x IN fs | DETACH DELETE x)
DETACH DELETE r
RETURN size(fs) AS deleted
`.trim(),
    { params: { id: analysisRunId } },
  );

  return { deletedFindings: res.data[0]?.deleted ?? 0 };
}
