"use client";

import type { EvidenceRef, EvidenceStatus } from "./types";

/**
 * A source record, shown verbatim.
 *
 * The excerpt is the actual text stored on the Source node. Nothing here is
 * summarised or rewritten, because the point of an evidence card is that the
 * user can check it.
 */
export function EvidenceCard({ evidence }: { evidence: EvidenceRef }) {
  return (
    <figure className="border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <figcaption className="mb-2 flex items-baseline gap-2">
        <span className="nf-graph-value text-[var(--color-accent)]">
          {evidence.sourceType}
        </span>
        <span className="text-xs text-[var(--color-ink-muted)]">{evidence.reference}</span>
      </figcaption>
      <blockquote className="border-l-2 border-[var(--color-line-strong)] pl-3 text-sm leading-relaxed text-[var(--color-ink)]">
        &ldquo;{evidence.excerpt}&rdquo;
      </blockquote>
      <div className="nf-graph-value mt-2 text-[var(--color-ink-faint)]">
        {evidence.sourceId}
      </div>
    </figure>
  );
}

/**
 * Evidence completeness, communicated by FORM first.
 *
 * A filled square means complete, a half square partial, a hollow square
 * missing — legible in greyscale and to a colour-blind reader.
 */
export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const glyph = status === "COMPLETE" ? "■" : status === "PARTIAL" ? "◧" : "□";
  const tone =
    status === "COMPLETE"
      ? "text-[var(--color-ink-muted)]"
      : status === "PARTIAL"
        ? "text-[var(--color-sev-warn)]"
        : "text-[var(--color-sev-high)]";
  const label =
    status === "COMPLETE"
      ? "complete evidence"
      : status === "PARTIAL"
        ? "partial evidence"
        : "missing evidence";

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`} title={label}>
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
      <span className="nf-graph-value">{status.toLowerCase()}</span>
    </span>
  );
}

/**
 * Claim class badge.
 *
 * OBSERVED and DERIVED are graph-derived classifications, so they render in
 * monospace; the distinction is the core epistemic contract of the product.
 */
export function ClaimBadge({ claim }: { claim: string }) {
  const style =
    claim === "OBSERVED"
      ? "border-[var(--color-accent-dim)] text-[var(--color-accent)]"
      : claim === "DERIVED"
        ? "border-[var(--color-line-strong)] text-[var(--color-ink-muted)]"
        : "border-dashed border-[var(--color-line-strong)] text-[var(--color-ink-faint)]";

  const title =
    claim === "OBSERVED"
      ? "Directly evidenced by a single relationship in the graph"
      : claim === "DERIVED"
        ? "Computed by chaining relationships under a versioned rule"
        : "A judgment produced by the system, not a graph fact";

  return (
    <span
      title={title}
      className={`nf-graph-value inline-block border px-1.5 py-0.5 text-[0.6875rem] uppercase ${style}`}
    >
      {claim}
    </span>
  );
}
