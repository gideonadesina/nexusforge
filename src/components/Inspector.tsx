"use client";

import { useEffect, useRef } from "react";
import type { ImpactedEntity } from "./types";
import { EvidenceCard, EvidenceBadge, ClaimBadge } from "./EvidenceCard";

/**
 * Inspector sheet — the receipt.
 *
 * Slides over the canvas as a floating layer (the only place translucency is
 * allowed). Shows the exact Cypher template, the bound parameters, the rows
 * returned, the path chain in hop order, and the verbatim source excerpts.
 *
 * The purpose is falsifiability: a user should be able to take what is in
 * here and re-run the query themselves.
 */

export interface InspectorProps {
  entity: ImpactedEntity | null;
  rootEntityId: string;
  maxDepth: number;
  onClose: () => void;
}

export function Inspector({ entity, rootEntityId, maxDepth, onClose }: InspectorProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the sheet when it opens.
  useEffect(() => {
    if (!entity) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [entity, onClose]);

  const open = entity !== null;

  return (
    <aside
      aria-label="Finding inspector"
      aria-hidden={!open}
      className={`nf-sheet nf-floating nf-scroll absolute inset-y-0 right-0 z-20 w-full max-w-xl overflow-y-auto border-l border-[var(--color-line-strong)] ${
        open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-4 opacity-0"
      }`}
    >
      {entity && (
        <div ref={ref} tabIndex={-1} className="p-5">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] pb-4">
            <div>
              <div className="nf-graph-value text-[var(--color-ink-muted)]">
                {entity.entityType}
              </div>
              <h2 className="mt-1 text-lg font-medium leading-snug">{entity.name}</h2>
              <div className="nf-graph-value mt-1 break-all text-[var(--color-ink-faint)]">
                {entity.entityId}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 border border-[var(--color-line-strong)] px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              Close
            </button>
          </header>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ClaimBadge claim={entity.claim} />
            <EvidenceBadge status={entity.evidenceStatus} />
            {!entity.supported && (
              <span className="text-xs text-[var(--color-sev-high)]">
                unsupported — must not be acted on
              </span>
            )}
          </div>

          <Section title="Why this is affected">
            <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
              {entity.claim === "OBSERVED"
                ? "A single dependency relationship connects this entity to the change, and that relationship is backed by a source record."
                : `This conclusion was derived by following ${entity.shortestPath.edgeHops} dependency relationships. No single record states it.`}
            </p>
            <PathChain entity={entity} />
          </Section>

          <Section title="Hop accounting">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="edge hops" value={entity.shortestPath.edgeHops} />
              <Stat label="entity hops" value={entity.shortestPath.entityHops} />
              <Stat label="distinct routes" value={entity.allPaths.length} />
              <Stat label="evidence records" value={entity.evidence.length} />
            </dl>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-faint)]">
              Edge hops count graph relationships. Entity hops count meaningful
              organizational transitions, ignoring intermediary nodes that only
              reify a relationship. They are deliberately not the same number.
            </p>
          </Section>

          {entity.allPaths.length > 1 && (
            <Section title={`Alternative routes (${entity.allPaths.length})`}>
              <ul className="space-y-2">
                {entity.allPaths.map((p, i) => (
                  <li
                    key={p.nodes.map((n) => n.id).join(">")}
                    className="border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2"
                  >
                    <div className="nf-graph-value nf-num mb-1 text-[var(--color-ink-faint)]">
                      route {i + 1} · {p.edgeHops}e / {p.entityHops}n
                    </div>
                    <div className="nf-graph-value break-all text-xs text-[var(--color-ink-muted)]">
                      {p.nodes.map((n) => n.id).join(" → ")}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                Several independent routes reach this entity. It is still counted
                once in the distinct impact total.
              </p>
            </Section>
          )}

          <Section title="Query receipt">
            <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
              The template that produced this row. Only the depth bound is
              interpolated, after integer validation; everything else is a bound
              parameter.
            </p>
            <pre className="nf-scroll overflow-x-auto border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3 text-[0.6875rem] leading-relaxed text-[var(--color-ink-muted)]">
              <code className="nf-graph-value">{cypherTemplate(maxDepth)}</code>
            </pre>
            <dl className="mt-2 space-y-1 text-xs">
              <ParamRow name="$rootId" value={rootEntityId} />
              <ParamRow name="depth bound" value={String(maxDepth)} />
              <ParamRow name="rows returned for this entity" value={String(entity.allPaths.length)} />
              <ParamRow name="rule" value={entity.ruleId} />
            </dl>
          </Section>

          <Section title={`Evidence (${entity.evidence.length})`}>
            {entity.evidence.length === 0 ? (
              <p className="text-sm text-[var(--color-sev-high)]">
                No evidence record resolved for this dependency chain.
              </p>
            ) : (
              <div className="space-y-2">
                {entity.evidence.map((ev) => (
                  <EvidenceCard key={ev.sourceId} evidence={ev} />
                ))}
              </div>
            )}

            {entity.unresolvedSourceIds.length > 0 && (
              <div className="mt-3 border border-dashed border-[var(--color-sev-warn)] p-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-[var(--color-sev-warn)]">
                  Unresolved references
                </div>
                <ul className="nf-graph-value space-y-0.5 text-xs text-[var(--color-ink-muted)]">
                  {entity.unresolvedSourceIds.map((s) => (
                    <li key={s} className="break-all">
                      {s}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                  These were cited by a relationship but no matching source record
                  exists. Nothing has been substituted for them.
                </p>
              </div>
            )}
          </Section>
        </div>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5">
      <dt className="text-xs text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="nf-graph-value nf-num text-base text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

function ParamRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="nf-graph-value shrink-0 text-[var(--color-accent)]">{name}</dt>
      <dd className="nf-graph-value break-all text-[var(--color-ink-muted)]">{value}</dd>
    </div>
  );
}

/**
 * The path chain. This is both the mobile presentation of the canvas and the
 * screen-reader equivalent of it, so it must carry the full structure.
 */
export function PathChain({ entity }: { entity: ImpactedEntity }) {
  const p = entity.shortestPath;
  return (
    <ol className="mt-3 space-y-1">
      {p.nodes.map((n, i) => (
        <li key={n.id} className="flex items-start gap-2">
          <span className="nf-graph-value nf-num w-5 shrink-0 text-right text-[var(--color-ink-faint)]">
            {i}
          </span>
          <span className="flex-1">
            <span className="nf-graph-value text-[var(--color-ink)]">{n.id}</span>
            <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
              {n.name}
              {n.intermediary && (
                <span className="ml-1 text-[var(--color-ink-faint)]">(intermediary)</span>
              )}
            </span>
            {i < p.relationshipIds.length && (
              <span className="nf-graph-value mt-0.5 block text-xs text-[var(--color-accent)]">
                ↓ DEPENDS_ON · {p.relationshipIds[i]}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function cypherTemplate(depth: number): string {
  return `MATCH p = (affected:Entity)-[:DEPENDS_ON*1..${depth}]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
  AND ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
RETURN affected.id                          AS entityId,
       [n IN nodes(p) | n.id]               AS pathIds,
       [r IN relationships(p) | r.id]       AS pathRelIds,
       [r IN relationships(p) | r.sourceId] AS pathSourceIds,
       length(p)                            AS edgeHops
ORDER BY entityId, edgeHops, pathIds`;
}
