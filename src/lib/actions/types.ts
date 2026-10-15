/**
 * Action proposals and audit events.
 *
 * Scope is deliberately tiny: PROPOSED -> APPROVED | REJECTED, nothing else.
 * REVIEWED, EXECUTED and VERIFIED are NOT implemented, because the system
 * cannot currently perform or confirm a real-world action, and modelling
 * states it cannot honour would be a lie encoded in the schema.
 */

/** The only states this stage implements. */
export type ProposalState = "PROPOSED" | "APPROVED" | "REJECTED";

/** The only transitions this stage implements. */
export const ALLOWED_TRANSITIONS: Record<ProposalState, ProposalState[]> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

/**
 * Who approved something.
 *
 * `DEMO_RUN_OWNER` means exactly: "whoever holds the owner token for this
 * analysis run clicked approve in a demonstration". It is NOT a named person,
 * NOT an authenticated identity, and NOT institutional authority. Real
 * approval authority requires identity and role checks that are out of scope.
 */
export type ApprovalAuthority = "DEMO_RUN_OWNER";

export const DEMO_AUTHORITY: ApprovalAuthority = "DEMO_RUN_OWNER";

export type AuditEventType = "PROPOSAL_APPROVED" | "PROPOSAL_REJECTED";

export interface ActionProposalRecord {
  proposalId: string;
  analysisRunId: string;
  /** Domain-neutral action verb, e.g. REASSIGN_DEPENDENCY. */
  actionType: string;
  /** Entity the action would act on. */
  targetEntityId: string;
  targetEntityType: string;
  targetEntityName: string;
  /** Finding that justifies this proposal. */
  findingId: string;
  state: ProposalState;
  /** Versioned rule that generated it. */
  ruleId: string;
  /** Deterministic, generated from graph facts. Not free text from a model. */
  rationale: string;
  /**
   * Always ASSESSED. A proposal is a recommendation about what someone should
   * do -- a judgment, never an observation.
   */
  claim: "ASSESSED";
  /** Evidence status inherited from the finding that justifies it. */
  evidenceStatus: string;
  supported: boolean;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: ApprovalAuthority | null;
}

export interface AuditEventRecord {
  auditEventId: string;
  analysisRunId: string;
  proposalId: string;
  eventType: AuditEventType;
  fromState: ProposalState;
  toState: ProposalState;
  at: string;
  actor: ApprovalAuthority;
  note: string | null;
}

/**
 * What an approval does and does not mean.
 *
 * Surfaced as data so the UI cannot quietly drop the caveat.
 */
export const APPROVAL_SEMANTICS = {
  approvedMeans: "A demo run owner recorded a decision to proceed.",
  approvedDoesNotMean:
    "The action has NOT been executed, scheduled, communicated, or verified. " +
    "NexusForge performs no external action.",
} as const;
