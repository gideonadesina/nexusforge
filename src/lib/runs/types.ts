/**
 * Persisted analysis-run and finding records.
 *
 * Sector-agnostic: a run is "an analysis of a change to some entity", and a
 * finding is "an entity exposed by that change". Neither type mentions a
 * school, and neither should ever need to.
 */
import type { ClaimClass, RuleId, EvidenceStatus } from "../engine/types";

export type RunStatus = "PENDING" | "COMPLETED" | "FAILED";

/**
 * Verification status of a finding.
 *
 * Stage 2A persists findings as UNVERIFIED: the dependency chain is observed,
 * but no independent re-check has been recorded against the individual
 * finding. Promoting a finding to VERIFIED requires real supporting evidence
 * and is deliberately not implemented yet.
 */
export type VerificationStatus = "UNVERIFIED" | "VERIFIED" | "CONTRADICTED";

export interface AnalysisRunRecord {
  analysisRunId: string;
  /** The change being analysed -- the input event reference. */
  rootEntityId: string;
  rootEntityType: string;
  rootName: string;
  maxDepth: number;
  status: RunStatus;
  ruleId: RuleId;
  /** Seed version of the organizational graph this run was computed against. */
  seedVersion: string;
  graphName: string;
  createdAt: string;
  updatedAt: string;
  distinctImpactedCount: number;
  totalPathCount: number;
  /**
   * How many times persistence has been attempted for this run. 1 means a
   * first write; >1 means a retry. This is what distinguishes a retry from a
   * new analysis.
   */
  persistAttempts: number;
}

export interface FindingRecord {
  findingId: string;
  analysisRunId: string;
  entityId: string;
  entityType: string;
  entityName: string;
  claim: ClaimClass;
  ruleId: RuleId;
  verificationStatus: VerificationStatus;
  /** Whether the evidence backing this finding actually resolves. */
  evidenceStatus: EvidenceStatus;
  /** False when the best route has unresolved evidence. */
  supported: boolean;
  /** Explicit record of evidence gaps. Never silently filled in. */
  unresolvedSourceIds: string[];
  /** Shortest route, as ordered entity ids. */
  shortestPathEntityIds: string[];
  /** DEPENDS_ON edge ids traversed by the shortest route. */
  shortestPathRelationshipIds: string[];
  edgeHops: number;
  entityHops: number;
  /** Number of distinct routes that reach this entity. */
  pathCount: number;
  /** Every route, as "a>b>c" signatures, so alternatives stay inspectable. */
  allPathSignatures: string[];
  /** Deduplicated source ids supporting this finding. */
  evidenceSourceIds: string[];
  createdAt: string;
}

/**
 * Result of creating a run.
 *
 * `ownerToken` is returned EXACTLY ONCE, in memory, to the caller that created
 * the run. It is never stored, never logged, and never re-readable: only its
 * SHA-256 hash is persisted.
 */
export interface CreatedRun {
  analysisRunId: string;
  ownerToken: string;
}
