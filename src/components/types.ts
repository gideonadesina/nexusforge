/** Shared view types. Mirrors the API payloads; no view-layer invention. */

export type ClaimClass = "OBSERVED" | "DERIVED" | "ASSESSED";
export type EvidenceStatus = "COMPLETE" | "PARTIAL" | "MISSING";
export type ProposalState = "PROPOSED" | "APPROVED" | "REJECTED";

export interface EvidenceRef {
  sourceId: string;
  reference: string;
  excerpt: string;
  sourceType: string;
}

export interface PathNode {
  id: string;
  entityType: string;
  name: string;
  intermediary: boolean;
}

export interface DependencyPath {
  nodes: PathNode[];
  relationshipIds: string[];
  edgeHops: number;
  entityHops: number;
  evidence: EvidenceRef[];
  evidenceStatus: EvidenceStatus;
  unresolvedSourceIds: string[];
}

export interface ImpactedEntity {
  entityId: string;
  entityType: string;
  name: string;
  shortestPath: DependencyPath;
  allPaths: DependencyPath[];
  evidence: EvidenceRef[];
  claim: ClaimClass;
  evidenceStatus: EvidenceStatus;
  supported: boolean;
  unresolvedSourceIds: string[];
  ruleId: string;
}

export interface Proposal {
  proposalId: string;
  analysisRunId: string;
  actionType: string;
  targetEntityId: string;
  targetEntityType: string;
  targetEntityName: string;
  findingId: string;
  state: ProposalState;
  ruleId: string;
  rationale: string;
  claim: "ASSESSED";
  evidenceStatus: EvidenceStatus;
  supported: boolean;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
}

export interface AuditEvent {
  auditEventId: string;
  analysisRunId: string;
  proposalId: string;
  eventType: string;
  fromState: ProposalState;
  toState: ProposalState;
  at: string;
  actor: string;
  note: string | null;
}

export interface AnalysisResponse {
  analysisRunId: string;
  root: { entityId: string; entityType: string; name: string };
  maxDepth: number;
  ruleId: string;
  distinctImpactedCount: number;
  totalPathCount: number;
  unevidencedEntityIds: string[];
  impacted: ImpactedEntity[];
  proposals: Proposal[];
  auditEvents: AuditEvent[];
  latencyMs: number;
}

export interface EntityOption {
  id: string;
  type: string;
  name: string;
  dependentCount: number;
}
