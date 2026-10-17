"use client";

import type { ImpactedEntity, Proposal } from "./types";
import { EvidenceBadge, ClaimBadge } from "./EvidenceCard";

/**
 * Findings, grouped into FIXED sections so the structure is learnable.
 *
 * Every section states the rule that fills it. Nothing is placed by
 * interpretation, and an empty section says so plainly rather than being
 * padded with something plausible.
 */

export interface Section {
  key: string;
  title: string;
  /** The computation that decides membership. Shown to the user. */
  rule: string;
  entities: ImpactedEntity[];
}

/**
 * Partition the impacted set.
 *
 * Sections are derived from graph structure only (hop distance, route
 * multiplicity, terminality, evidence completeness), so the grouping carries
 * across sectors and never depends on domain vocabulary.
 */
export function buildSections(impacted: ImpactedEntity[]): Section[] {
  const impactedIds = new Set(impacted.map((e) => e.entityId));

  // An entity is terminal when no OTHER impacted entity depends on it, i.e.
  // it never appears as a downstream step in someone else's route. That is
  // where exposure surfaces rather than propagates.
  const appearsAsIntermediate = new Set<string>();
  for (const e of impacted) {
    for (const p of e.allPaths) {
      // nodes[0] is the affected entity itself; the rest are steps it passes
      // through on the way to the root.
      for (const n of p.nodes.slice(1)) {
        if (impactedIds.has(n.id)) appearsAsIntermediate.add(n.id);
      }
    }
  }

  return [
    {
      key: "direct",
      title: "Directly affected",
      rule: "one dependency relationship from the change",
      entities: impacted.filter((e) => e.shortestPath.edgeHops === 1),
    },
    {
      key: "indirect",
      title: "Indirectly affected",
      rule: "reached through two or more relationships",
      entities: impacted.filter((e) => e.shortestPath.edgeHops > 1),
    },
    {
      key: "surface",
      title: "Where impact surfaces",
      rule: "nothing else in this analysis depends on these, so the exposure ends here",
      entities: impacted.filter((e) => !appearsAsIntermediate.has(e.entityId)),
    },
    {
      key: "constrained",
      title: "Multiple dependency routes",
      rule: "reached by more than one distinct dependency route",
      entities: impacted.filter((e) => e.allPaths.length > 1),
    },
    {
      key: "unknowns",
      title: "Unknowns",
      rule: "evidence cited by a relationship did not resolve",
      entities: impacted.filter((e) => e.evidenceStatus !== "COMPLETE"),
    },
  ];
}

export function FindingsList({
  impacted,
  proposals,
  selectedId,
  onSelect,
}: {
  impacted: ImpactedEntity[];
  proposals: Proposal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sections = buildSections(impacted);
  const openProposals = proposals.filter((p) => p.state === "PROPOSED");

  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.key}>
          <header className="mb-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{s.title}</h3>
              <span className="nf-graph-value nf-num text-xs text-[var(--color-ink-faint)]">
                {s.entities.length}
              </span>
            </div>
            <p className="text-xs leading-snug text-[var(--color-ink-faint)]">{s.rule}</p>
          </header>

          {s.entities.length === 0 ? (
            <p className="border border-dashed border-[var(--color-line)] px-2 py-1.5 text-xs text-[var(--color-ink-faint)]">
              None identified in this graph.
            </p>
          ) : (
            <ul className="space-y-1">
              {s.entities.map((e) => (
                <li key={e.entityId}>
                  <FindingRow
                    entity={e}
                    selected={e.entityId === selectedId}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section>
        <header className="mb-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Ownership</h3>
            <span className="nf-graph-value nf-num text-xs text-[var(--color-ink-faint)]">
              {openProposals.length}
            </span>
          </div>
          <p className="text-xs leading-snug text-[var(--color-ink-faint)]">
            proposals awaiting a decision
          </p>
        </header>
        {openProposals.length === 0 ? (
          <p className="border border-dashed border-[var(--color-line)] px-2 py-1.5 text-xs text-[var(--color-ink-faint)]">
            No open proposals.
          </p>
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {openProposals.length} proposal{openProposals.length === 1 ? "" : "s"} listed
            below.
          </p>
        )}
      </section>
    </div>
  );
}

function FindingRow({
  entity,
  selected,
  onSelect,
}: {
  entity: ImpactedEntity;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entity.entityId)}
      aria-pressed={selected}
      className={`nf-anim w-full border px-2 py-1.5 text-left ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
          : "border-transparent hover:border-[var(--color-line)] hover:bg-[var(--color-surface-1)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm">{entity.name}</span>
        <span className="nf-graph-value nf-num shrink-0 text-xs text-[var(--color-ink-faint)]">
          {entity.shortestPath.edgeHops}e
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <ClaimBadge claim={entity.claim} />
        <EvidenceBadge status={entity.evidenceStatus} />
      </div>
    </button>
  );
}
