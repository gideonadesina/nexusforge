import { roQuery } from "../falkor/client";
import {
  impactQuery,
  recheckDistinctCountQuery,
  GET_ENTITY,
  GET_SOURCES,
  assertDepth,
} from "../graph/queries";
import type {
  ImpactAnalysis,
  ImpactedEntity,
  DependencyPath,
  PathNode,
  EvidenceRef,
  EvidenceStatus,
  ClaimClass,
} from "./types";

/**
 * Deterministic downstream-impact analysis.
 *
 * This module is sector-agnostic. It contains no school vocabulary and no
 * knowledge of which entities "should" be affected: the answer is whatever the
 * graph's dependency edges say, and nothing more.
 *
 * What it deliberately does NOT do:
 *  - assign severity
 *  - claim an affected responsibility has failed
 *  - infer eligibility, availability, or policy
 * Those are Stage 2 concerns and would be judgments, not observations.
 */

/** Versioned identifier of the rule implemented here. */
export const IMPACT_RULE_ID = "rule.impact.dependency-reachability@1";

export const DEFAULT_DEPTH = 6;

/** Raw row shape returned by `impactQuery`. */
interface ImpactRow {
  entityId: string;
  entityType: string;
  entityName: string;
  pathIds: string[];
  pathTypes: string[];
  pathNames: string[];
  pathIntermediary: boolean[];
  pathSourceIds: Array<string | null>;
  pathKinds: Array<string | null>;
  pathRelIds: Array<string | null>;
  edgeHops: number;
}

/**
 * Count meaningful organizational transitions along a path.
 *
 * `edgeHops` counts relationships. Intermediary nodes (an assignment reifying
 * a person-to-duty link, for example) are structural glue, so traversing
 * through one is not an additional organizational transition. We therefore
 * subtract the intermediary nodes strictly *between* the endpoints.
 *
 * These two numbers are reported separately and never conflated (rule 2.4).
 */
function countEntityHops(intermediary: boolean[], edgeHops: number): number {
  const interior = intermediary.slice(1, Math.max(1, intermediary.length - 1));
  const interiorIntermediaries = interior.filter(Boolean).length;
  return Math.max(1, edgeHops - interiorIntermediaries);
}

/** Stable signature so path ordering is deterministic across runs. */
function pathSignature(ids: string[]): string {
  return ids.join(">");
}

/** Rank evidence statuses so "best available route" is well defined. */
const EVIDENCE_RANK: Record<EvidenceStatus, number> = {
  COMPLETE: 0,
  PARTIAL: 1,
  MISSING: 2,
};

/**
 * Classify an exposure from the routes that reach it.
 *
 * Two independent questions, deliberately not conflated:
 *
 * 1. HOW was it established? A single relationship read straight out of the
 *    graph is OBSERVED. Two or more relationships chained together is
 *    DERIVED -- transitive reachability is a conclusion produced by this
 *    rule, not a fact any single record asserts.
 *
 * 2. Is it SUPPORTED? Only if every edge on the chosen route resolves to a
 *    real Source node. A one-hop dependency whose evidence does not resolve
 *    is NOT an observed fact, so it degrades to DERIVED and is marked
 *    unsupported.
 *
 * The entity is judged on its best-evidenced route, with the shortest route
 * breaking ties -- that is the strongest honest claim available.
 */
export function classifyExposure(allPaths: DependencyPath[]): {
  claim: ClaimClass;
  evidenceStatus: EvidenceStatus;
  supported: boolean;
  unresolvedSourceIds: string[];
} {
  const best = [...allPaths].sort(
    (a, b) =>
      EVIDENCE_RANK[a.evidenceStatus] - EVIDENCE_RANK[b.evidenceStatus] ||
      a.edgeHops - b.edgeHops,
  )[0];

  const unresolvedSourceIds = [
    ...new Set(allPaths.flatMap((p) => p.unresolvedSourceIds)),
  ].sort();

  if (!best) {
    // No route at all should be impossible here, but never claim support we
    // cannot demonstrate.
    return {
      claim: "DERIVED",
      evidenceStatus: "MISSING",
      supported: false,
      unresolvedSourceIds,
    };
  }

  const fullyEvidenced = best.evidenceStatus === "COMPLETE";
  const directlyObserved = best.edgeHops === 1 && fullyEvidenced;

  return {
    claim: directlyObserved ? "OBSERVED" : "DERIVED",
    evidenceStatus: best.evidenceStatus,
    supported: fullyEvidenced,
    unresolvedSourceIds,
  };
}

/**
 * Invariant guard: an unsupported finding may never be recorded as verified.
 *
 * Verification is not implemented, so this exists to make the rule explicit
 * and enforceable now rather than after someone adds a verification path.
 */
export function assertVerifiableOnlyIfSupported(
  supported: boolean,
  verificationStatus: string,
): void {
  if (verificationStatus === "VERIFIED" && !supported) {
    throw new Error(
      "Refusing to mark an unsupported finding VERIFIED: its evidence does not resolve.",
    );
  }
}

function buildPathNodes(row: ImpactRow): PathNode[] {
  return row.pathIds.map((id, i) => ({
    id,
    entityType: row.pathTypes[i] ?? "Unknown",
    name: row.pathNames[i] ?? id,
    intermediary: row.pathIntermediary[i] === true,
  }));
}

export interface AnalyseOptions {
  /** Traversal bound. Defaults to DEFAULT_DEPTH, hard-capped by assertDepth. */
  maxDepth?: number;
}

/**
 * Run the impact analysis for a change at `rootEntityId`.
 *
 * Throws if the root entity does not exist: an analysis rooted at nothing is a
 * bug, not an empty result.
 */
export async function analyseImpact(
  graphName: string,
  rootEntityId: string,
  options: AnalyseOptions = {},
): Promise<ImpactAnalysis> {
  const maxDepth = assertDepth(options.maxDepth ?? DEFAULT_DEPTH);

  // 1. Confirm the root exists.
  const rootRes = await roQuery<{ id: string; type: string; name: string }>(
    graphName,
    GET_ENTITY,
    { params: { id: rootEntityId } },
  );
  const root = rootRes.data[0];
  if (!root) {
    throw new Error(
      `Root entity "${rootEntityId}" not found in graph "${graphName}". ` +
        `Seed the graph before running an analysis.`,
    );
  }

  // 2. Traverse. One row per distinct route.
  const rows = await roQuery<ImpactRow>(graphName, impactQuery(maxDepth), {
    params: { rootId: rootEntityId },
  });

  // 3. Resolve every referenced source in one round trip.
  const sourceIds = new Set<string>();
  for (const row of rows.data) {
    for (const sid of row.pathSourceIds) {
      if (typeof sid === "string" && sid.length > 0) sourceIds.add(sid);
    }
  }

  const evidenceById = new Map<string, EvidenceRef>();
  if (sourceIds.size > 0) {
    const srcRes = await roQuery<EvidenceRef>(graphName, GET_SOURCES, {
      params: { ids: [...sourceIds].sort() },
    });
    for (const s of srcRes.data) evidenceById.set(s.sourceId, s);
  }

  // 4. Collapse routes into distinct entities. An entity reached by three
  //    routes is ONE impacted entity with three inspectable paths.
  interface EntityBucket {
    rows: ImpactRow[];
    paths: Map<string, DependencyPath>;
  }
  const byEntity = new Map<string, EntityBucket>();
  const unevidenced = new Set<string>();

  for (const row of rows.data) {
    const nodes = buildPathNodes(row);
    const sig = pathSignature(row.pathIds);

    // Evidence is assessed per EDGE, because a route is only as supported as
    // its weakest link. An edge either names a source that resolves to a real
    // Source node, or it is an evidence gap that must be reported as one.
    const pathEvidence: EvidenceRef[] = [];
    const unresolved: string[] = [];
    let resolvedEdges = 0;

    row.pathSourceIds.forEach((sid, i) => {
      if (typeof sid !== "string" || sid.length === 0) {
        // The edge cites nothing at all.
        unresolved.push(`${row.pathRelIds[i] ?? `edge_${i}`}:no-source-cited`);
        return;
      }
      const ev = evidenceById.get(sid);
      if (ev) {
        pathEvidence.push(ev);
        resolvedEdges += 1;
      } else {
        // The edge names a source that does not exist as a node. Report the
        // gap; never invent the missing record.
        unresolved.push(sid);
      }
    });

    const totalEdges = row.edgeHops;
    const evidenceStatus: EvidenceStatus =
      resolvedEdges === totalEdges ? "COMPLETE" : resolvedEdges === 0 ? "MISSING" : "PARTIAL";

    if (evidenceStatus !== "COMPLETE") unevidenced.add(row.entityId);

    const path: DependencyPath = {
      nodes,
      relationshipIds: row.pathRelIds.map((id, i) => id ?? `unidentified_edge_${i}`),
      edgeHops: row.edgeHops,
      entityHops: countEntityHops(row.pathIntermediary, row.edgeHops),
      evidence: pathEvidence,
      evidenceStatus,
      unresolvedSourceIds: unresolved,
    };

    const bucket: EntityBucket = byEntity.get(row.entityId) ?? {
      rows: [],
      paths: new Map<string, DependencyPath>(),
    };
    bucket.rows.push(row);
    // Keyed by signature so an identical route can never be double-counted.
    bucket.paths.set(sig, path);
    byEntity.set(row.entityId, bucket);
  }

  // 5. Build the typed result.
  const impacted: ImpactedEntity[] = [];
  let totalPathCount = 0;

  for (const [entityId, bucket] of [...byEntity.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const allPaths = [...bucket.paths.values()].sort(
      (a, b) =>
        a.edgeHops - b.edgeHops ||
        pathSignature(a.nodes.map((n) => n.id)).localeCompare(
          pathSignature(b.nodes.map((n) => n.id)),
        ),
    );
    totalPathCount += allPaths.length;

    const shortestPath = allPaths[0];
    if (!shortestPath) continue;

    const firstRow = bucket.rows[0];
    if (!firstRow) continue;

    const distinctEvidence = new Map<string, EvidenceRef>();
    for (const p of allPaths) {
      for (const e of p.evidence) distinctEvidence.set(e.sourceId, e);
    }

    impacted.push({
      entityId,
      entityType: firstRow.entityType,
      name: firstRow.entityName,
      shortestPath,
      allPaths,
      ...classifyExposure(allPaths),
      evidence: [...distinctEvidence.values()].sort((a, b) =>
        a.sourceId.localeCompare(b.sourceId),
      ),
      ruleId: IMPACT_RULE_ID,
    });
  }

  return {
    rootEntityId: root.id,
    rootEntityType: root.type,
    rootName: root.name,
    maxDepth,
    impacted,
    distinctImpactedCount: impacted.length,
    totalPathCount,
    unevidencedEntityIds: [...unevidenced].sort(),
    ruleId: IMPACT_RULE_ID,
    graphName,
  };
}

/**
 * Independent re-check of the distinct-entity count using a differently
 * formulated query (architecture 2.5). Returns both numbers so a caller or
 * test can assert they agree rather than trusting one implementation.
 */
export async function recheckDistinctCount(
  graphName: string,
  rootEntityId: string,
  maxDepth: number = DEFAULT_DEPTH,
): Promise<number> {
  const res = await roQuery<{ distinctCount: number }>(
    graphName,
    recheckDistinctCountQuery(assertDepth(maxDepth)),
    { params: { rootId: rootEntityId } },
  );
  return res.data[0]?.distinctCount ?? 0;
}
