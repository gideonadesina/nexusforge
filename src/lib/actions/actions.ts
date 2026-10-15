import { roQuery } from "../falkor/client";
import { withRunAuthorization, type RunCredentials } from "../runs/authz";
import { findingIdFor } from "../runs/persist";
import { generateProposals } from "./rules";
import type { ImpactAnalysis } from "../engine/types";
import {
  ALLOWED_TRANSITIONS,
  DEMO_AUTHORITY,
  type ActionProposalRecord,
  type AuditEventRecord,
  type AuditEventType,
  type ProposalState,
} from "./types";

/**
 * Action-proposal handlers.
 *
 * ENCAPSULATION (Stage 2B requirement): this module imports `roQuery` for
 * reads and `withRunAuthorization` for writes, and deliberately does NOT
 * import `writeQuery` or `dropGraph`. Application action handlers therefore
 * have no generic write or delete access to the graph -- every mutation they
 * can perform is ownership-checked inside its own statement. A test asserts
 * this import restriction so it cannot silently regress.
 */

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

/** Deterministic ids, so retries converge instead of duplicating. */
export function proposalIdFor(runId: string, ruleId: string, entityId: string): string {
  return `${runId}::${ruleId}::${entityId}`;
}

export function auditEventIdFor(proposalId: string, toState: ProposalState): string {
  return `${proposalId}::${toState}`;
}

/* ------------------------------------------------------------------ *
 * Generate and persist proposals
 * ------------------------------------------------------------------ */

export interface ProposeResult {
  proposalsWritten: number;
  proposalIds: string[];
}

/**
 * Persist proposals derived from a real analysis.
 *
 * Each proposal is linked to the run, to the Finding that justifies it, and
 * to the target entity. Idempotent via a deterministic `proposalId`.
 *
 * Note the `ADDRESSES` edge requires the Finding to exist, so a proposal can
 * never be attached to a finding that was not actually computed.
 */
export async function proposeActions(
  graphName: string,
  creds: RunCredentials,
  analysis: ImpactAnalysis,
): Promise<ProposeResult> {
  const now = new Date().toISOString();
  const drafts = generateProposals(analysis);

  if (drafts.length === 0) return { proposalsWritten: 0, proposalIds: [] };

  const rows = drafts.map((d) => ({
    proposalId: proposalIdFor(creds.analysisRunId, d.ruleId, d.targetEntityId),
    findingId: findingIdFor(creds.analysisRunId, d.targetEntityId),
    actionType: d.actionType,
    targetEntityId: d.targetEntityId,
    targetEntityType: d.targetEntityType,
    targetEntityName: d.targetEntityName,
    ruleId: d.ruleId,
    rationale: d.rationale,
    evidenceStatus: d.evidenceStatus,
    supported: d.supported,
    createdAt: now,
  }));

  await withRunAuthorization(
    graphName,
    creds,
    `
UNWIND $rows AS row
MATCH (fd:Finding {findingId: row.findingId})-[:PART_OF_RUN]->(run)
MERGE (p:ActionProposal {proposalId: row.proposalId})
SET p.analysisRunId    = $runId,
    p.actionType       = row.actionType,
    p.targetEntityId   = row.targetEntityId,
    p.targetEntityType = row.targetEntityType,
    p.targetEntityName = row.targetEntityName,
    p.findingId        = row.findingId,
    p.ruleId           = row.ruleId,
    p.rationale        = row.rationale,
    p.evidenceStatus   = row.evidenceStatus,
    p.supported        = row.supported,
    p.claim            = 'ASSESSED',
    p.state            = coalesce(p.state, 'PROPOSED'),
    p.createdAt        = coalesce(p.createdAt, row.createdAt),
    p.updatedAt        = row.createdAt,
    p.synthetic        = true
MERGE (p)-[:PROPOSED_IN]->(run)
MERGE (p)-[:ADDRESSES]->(fd)
WITH run, collect(p) AS ps
RETURN size(ps) AS written
`,
    ``,
    { rows },
  );

  // Link proposals to their target entity in a separate idempotent statement.
  await withRunAuthorization(
    graphName,
    creds,
    `
UNWIND $rows AS row
MATCH (p:ActionProposal {proposalId: row.proposalId})-[:PROPOSED_IN]->(run)
MATCH (e:Entity {id: row.targetEntityId})
MERGE (p)-[:TARGETS]->(e)
WITH run, collect(p) AS ps
RETURN size(ps) AS linked
`,
    ``,
    { rows },
  );

  return {
    proposalsWritten: rows.length,
    proposalIds: rows.map((r) => r.proposalId),
  };
}

/* ------------------------------------------------------------------ *
 * State transitions (the only two implemented)
 * ------------------------------------------------------------------ */

export interface TransitionResult {
  proposalId: string;
  fromState: ProposalState;
  toState: ProposalState;
  auditEventId: string;
  /** Explicit reminder that a decision is not an execution. */
  executed: false;
}

async function transition(
  graphName: string,
  creds: RunCredentials,
  proposalId: string,
  toState: Extract<ProposalState, "APPROVED" | "REJECTED">,
  note: string | null,
): Promise<TransitionResult> {
  const fromState: ProposalState = "PROPOSED";
  if (!ALLOWED_TRANSITIONS[fromState].includes(toState)) {
    throw new InvalidTransitionError(`Transition ${fromState} -> ${toState} is not allowed.`);
  }

  const now = new Date().toISOString();
  const eventType: AuditEventType =
    toState === "APPROVED" ? "PROPOSAL_APPROVED" : "PROPOSAL_REJECTED";
  const auditEventId = auditEventIdFor(proposalId, toState);

  // One statement enforces ALL of:
  //   - run ownership (the MATCH injected by withRunAuthorization)
  //   - the proposal belongs to THAT run (the -[:PROPOSED_IN]-> hop)
  //   - the expected previous state (WHERE p.state = $fromState)
  // and writes the state change together with its audit event, so the two can
  // never disagree. A repeated call finds state != PROPOSED, matches nothing,
  // and therefore creates no second audit event.
  let rows: Array<{ auditEventId: string; toState: ProposalState }>;
  try {
    rows = await withRunAuthorization<{ auditEventId: string; toState: ProposalState }>(
      graphName,
      creds,
      `
MATCH (p:ActionProposal {proposalId: $proposalId})-[:PROPOSED_IN]->(run)
WHERE p.state = $fromState
SET p.state        = $toState,
    p.updatedAt    = $now,
    p.decidedAt    = $now,
    p.decisionNote = $note,
    p.decidedBy    = $actor
CREATE (a:AuditEvent {
  auditEventId:  $auditEventId,
  analysisRunId: $runId,
  proposalId:    $proposalId,
  eventType:     $eventType,
  fromState:     $fromState,
  toState:       $toState,
  at:            $now,
  actor:         $actor,
  note:          $note,
  synthetic:     true
})
MERGE (a)-[:ABOUT_PROPOSAL]->(p)
MERGE (a)-[:IN_RUN]->(run)
`,
      `RETURN a.auditEventId AS auditEventId, p.state AS toState`,
      {
        proposalId,
        fromState,
        toState,
        now,
        note,
        actor: DEMO_AUTHORITY,
        eventType,
        auditEventId,
      },
    );
  } catch (err) {
    // withRunAuthorization throws RunAuthorizationError when zero rows come
    // back. That is ambiguous here: it means "not authorized" OR "the
    // proposal was not in the expected state". Distinguish the two with a
    // read, so an invalid transition is not misreported as an auth failure.
    const current = await getProposal(graphName, proposalId);
    if (current && current.state !== fromState) {
      throw new InvalidTransitionError(
        `Proposal ${proposalId} is ${current.state}, not ${fromState}. ` +
          `Only ${fromState} -> APPROVED|REJECTED is implemented.`,
      );
    }
    throw err;
  }

  return {
    proposalId,
    fromState,
    toState,
    auditEventId: rows[0]?.auditEventId ?? auditEventId,
    executed: false,
  };
}

/**
 * Record a demo-owner decision to proceed.
 *
 * This does NOT execute anything. NexusForge performs no external action.
 */
export function approveProposal(
  graphName: string,
  creds: RunCredentials,
  proposalId: string,
  note: string | null = null,
): Promise<TransitionResult> {
  return transition(graphName, creds, proposalId, "APPROVED", note);
}

export function rejectProposal(
  graphName: string,
  creds: RunCredentials,
  proposalId: string,
  note: string | null = null,
): Promise<TransitionResult> {
  return transition(graphName, creds, proposalId, "REJECTED", note);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

const PROPOSAL_COLUMNS = `
  p.proposalId      AS proposalId,
  p.analysisRunId   AS analysisRunId,
  p.actionType      AS actionType,
  p.targetEntityId  AS targetEntityId,
  p.targetEntityType AS targetEntityType,
  p.targetEntityName AS targetEntityName,
  p.findingId       AS findingId,
  p.state           AS state,
  p.ruleId          AS ruleId,
  p.rationale       AS rationale,
  p.claim           AS claim,
  p.evidenceStatus  AS evidenceStatus,
  p.supported       AS supported,
  p.createdAt       AS createdAt,
  p.updatedAt       AS updatedAt,
  p.decidedAt       AS decidedAt,
  p.decisionNote    AS decisionNote,
  p.decidedBy       AS decidedBy
`.trim();

export async function getProposal(
  graphName: string,
  proposalId: string,
): Promise<ActionProposalRecord | null> {
  const res = await roQuery<ActionProposalRecord>(
    graphName,
    `MATCH (p:ActionProposal {proposalId: $id}) RETURN ${PROPOSAL_COLUMNS}`,
    { params: { id: proposalId } },
  );
  return res.data[0] ?? null;
}

export async function listProposals(
  graphName: string,
  analysisRunId: string,
): Promise<ActionProposalRecord[]> {
  const res = await roQuery<ActionProposalRecord>(
    graphName,
    `MATCH (p:ActionProposal)-[:PROPOSED_IN]->(r:AnalysisRun {analysisRunId: $id})
     RETURN ${PROPOSAL_COLUMNS} ORDER BY proposalId`,
    { params: { id: analysisRunId } },
  );
  return res.data;
}

export async function listAuditEvents(
  graphName: string,
  analysisRunId: string,
): Promise<AuditEventRecord[]> {
  const res = await roQuery<AuditEventRecord>(
    graphName,
    `MATCH (a:AuditEvent)-[:IN_RUN]->(r:AnalysisRun {analysisRunId: $id})
     RETURN a.auditEventId  AS auditEventId,
            a.analysisRunId AS analysisRunId,
            a.proposalId    AS proposalId,
            a.eventType     AS eventType,
            a.fromState     AS fromState,
            a.toState       AS toState,
            a.at            AS at,
            a.actor         AS actor,
            a.note          AS note
     ORDER BY at, auditEventId`,
    { params: { id: analysisRunId } },
  );
  return res.data;
}

export async function listAuditEventsForProposal(
  graphName: string,
  proposalId: string,
): Promise<AuditEventRecord[]> {
  const res = await roQuery<AuditEventRecord>(
    graphName,
    `MATCH (a:AuditEvent)-[:ABOUT_PROPOSAL]->(p:ActionProposal {proposalId: $id})
     RETURN a.auditEventId AS auditEventId, a.proposalId AS proposalId,
            a.analysisRunId AS analysisRunId, a.eventType AS eventType,
            a.fromState AS fromState, a.toState AS toState,
            a.at AS at, a.actor AS actor, a.note AS note
     ORDER BY at, auditEventId`,
    { params: { id: proposalId } },
  );
  return res.data;
}
