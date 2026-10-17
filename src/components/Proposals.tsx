"use client";

import { useState } from "react";
import type { AuditEvent, Proposal } from "./types";
import { EvidenceBadge } from "./EvidenceCard";

/**
 * Action proposals and the approval bar.
 *
 * The one thing this component must never do is imply that approving
 * something made it happen. The caveat is rendered as part of the control,
 * not tucked into a footnote.
 */
export function Proposals({
  proposals,
  auditEvents,
  canDecide,
  busyId,
  onDecide,
  onSelectTarget,
}: {
  proposals: Proposal[];
  auditEvents: AuditEvent[];
  canDecide: boolean;
  busyId: string | null;
  onDecide: (proposalId: string, decision: "APPROVED" | "REJECTED") => void;
  onSelectTarget: (entityId: string) => void;
}) {
  if (proposals.length === 0) {
    return (
      <p className="border border-dashed border-[var(--color-line)] px-2 py-1.5 text-xs text-[var(--color-ink-faint)]">
        No proposals were generated. The rules fire only where the graph
        supports them.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="border-l-2 border-[var(--color-sev-warn)] pl-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        A decision here is recorded, <strong>not executed</strong>. NexusForge
        performs no external action and cannot confirm one.
      </p>

      {proposals.map((p) => (
        <ProposalCard
          key={p.proposalId}
          proposal={p}
          events={auditEvents.filter((e) => e.proposalId === p.proposalId)}
          canDecide={canDecide}
          busy={busyId === p.proposalId}
          onDecide={onDecide}
          onSelectTarget={onSelectTarget}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  events,
  canDecide,
  busy,
  onDecide,
  onSelectTarget,
}: {
  proposal: Proposal;
  events: AuditEvent[];
  canDecide: boolean;
  busy: boolean;
  onDecide: (proposalId: string, decision: "APPROVED" | "REJECTED") => void;
  onSelectTarget: (entityId: string) => void;
}) {
  const [showRule, setShowRule] = useState(false);
  const open = proposal.state === "PROPOSED";

  const stateStyle =
    proposal.state === "APPROVED"
      ? "border-[var(--color-accent-dim)] text-[var(--color-accent)]"
      : proposal.state === "REJECTED"
        ? "border-[var(--color-line-strong)] text-[var(--color-ink-faint)]"
        : "border-[var(--color-sev-warn)] text-[var(--color-sev-warn)]";

  return (
    <article className="border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="nf-graph-value text-[var(--color-accent)]">
            {proposal.actionType}
          </div>
          <button
            type="button"
            onClick={() => onSelectTarget(proposal.targetEntityId)}
            className="mt-0.5 block truncate text-left text-sm hover:underline"
            title="Trace this entity on the canvas"
          >
            {proposal.targetEntityName}
          </button>
        </div>
        <span
          className={`nf-graph-value shrink-0 border px-1.5 py-0.5 text-[0.6875rem] uppercase ${stateStyle}`}
        >
          {proposal.state}
        </span>
      </header>

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        {proposal.rationale}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <EvidenceBadge status={proposal.evidenceStatus} />
        {!proposal.supported && (
          <span className="text-xs text-[var(--color-sev-high)]">
            unsupported, resolve evidence first
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowRule((v) => !v)}
          className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
          aria-expanded={showRule}
        >
          {showRule ? "▾" : "▸"} rule
        </button>
      </div>

      {showRule && (
        <dl className="mt-2 space-y-0.5 border-t border-[var(--color-line)] pt-2 text-xs">
          <div className="flex gap-2">
            <dt className="text-[var(--color-ink-faint)]">rule</dt>
            <dd className="nf-graph-value break-all text-[var(--color-ink-muted)]">
              {proposal.ruleId}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-ink-faint)]">claim</dt>
            <dd className="nf-graph-value text-[var(--color-ink-muted)]">
              {proposal.claim}: a recommendation, not a graph fact
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-ink-faint)]">id</dt>
            <dd className="nf-graph-value break-all text-[var(--color-ink-faint)]">
              {proposal.proposalId}
            </dd>
          </div>
        </dl>
      )}

      {open ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={!canDecide || busy}
            onClick={() => onDecide(proposal.proposalId, "APPROVED")}
            className="border border-[var(--color-accent-dim)] px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-surface-3)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Recording…" : "Approve decision"}
          </button>
          <button
            type="button"
            disabled={!canDecide || busy}
            onClick={() => onDecide(proposal.proposalId, "REJECTED")}
            className="border border-[var(--color-line-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reject
          </button>
          {!canDecide && (
            <span className="text-xs text-[var(--color-ink-faint)]">
              only the browser that started this run may decide
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 border-t border-[var(--color-line)] pt-2">
          {events.map((e) => (
            <div key={e.auditEventId} className="text-xs text-[var(--color-ink-muted)]">
              <span className="nf-graph-value text-[var(--color-ink-faint)]">
                {e.fromState} → {e.toState}
              </span>
              <span className="ml-2">
                by <span className="nf-graph-value">{e.actor}</span>
              </span>
              <time className="nf-graph-value nf-num ml-2 text-[var(--color-ink-faint)]">
                {e.at}
              </time>
              <div className="mt-0.5 text-[var(--color-ink-faint)]">
                Recorded only. Not executed.
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** Append-only audit trail for the whole run. */
export function AuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="border border-dashed border-[var(--color-line)] px-2 py-1.5 text-xs text-[var(--color-ink-faint)]">
        No decisions recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li
          key={e.auditEventId}
          className="border-l-2 border-[var(--color-line-strong)] pl-2 text-xs"
        >
          <div className="nf-graph-value text-[var(--color-ink)]">{e.eventType}</div>
          <div className="text-[var(--color-ink-faint)]">
            <span className="nf-graph-value">
              {e.fromState} → {e.toState}
            </span>
            {" · "}
            <span className="nf-graph-value">{e.actor}</span>
          </div>
          <time className="nf-graph-value nf-num text-[var(--color-ink-faint)]">{e.at}</time>
        </li>
      ))}
    </ol>
  );
}
