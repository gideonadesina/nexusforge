"use client";

import type { AnalysisResponse, Proposal } from "./types";

/**
 * Investigation headline.
 *
 * Every number is counted from the verified result. No severity is assigned,
 * no urgency is implied, and nothing is hardcoded — if the graph changes, the
 * sentence changes with it.
 *
 * The timing line states what actually happened: the analysis is already
 * finished, and the reveal is exploration of a completed result, not live
 * computation.
 */
export function Headline({
  analysis,
  proposals,
  revealing,
  onSkip,
}: {
  analysis: AnalysisResponse;
  proposals: Proposal[];
  revealing: boolean;
  onSkip: () => void;
}) {
  const direct = analysis.impacted.filter((e) => e.shortestPath.edgeHops === 1).length;
  const indirect = analysis.impacted.length - direct;
  const incomplete = analysis.impacted.filter((e) => e.evidenceStatus !== "COMPLETE").length;
  const open = proposals.filter((p) => p.state === "PROPOSED").length;

  return (
    <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-1)] px-6 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="max-w-3xl text-sm leading-relaxed">
          A change to{" "}
          <span className="nf-graph-value text-[var(--color-ink)]">{analysis.root.name}</span>{" "}
          exposes{" "}
          <Count n={analysis.distinctImpactedCount} noun="entity" plural="entities" /> across{" "}
          <Count n={analysis.totalPathCount} noun="dependency path" plural="dependency paths" />
          {" — "}
          <Count n={direct} noun="directly affected" plural="directly affected" bare />,{" "}
          <Count n={indirect} noun="through intermediaries" plural="through intermediaries" bare />.{" "}
          {incomplete === 0 ? (
            <>All cited evidence resolves.</>
          ) : (
            <>
              <span className="text-[var(--color-sev-warn)]">
                {incomplete} {incomplete === 1 ? "finding has" : "findings have"} unresolved
                evidence
              </span>{" "}
              and must not be acted on until the gap is closed.
            </>
          )}{" "}
          {open > 0 ? (
            <>
              <Count n={open} noun="action is" plural="actions are" bare /> proposed and awaiting
              a decision.
            </>
          ) : (
            <>No actions are awaiting a decision.</>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-3">
          <span className="nf-graph-value nf-num text-xs text-[var(--color-ink-faint)]">
            Analysis complete · {analysis.latencyMs} ms
          </span>
          {revealing && (
            <button
              type="button"
              onClick={onSkip}
              className="border border-[var(--color-line-strong)] px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              Skip reveal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Count({
  n,
  noun,
  plural,
  bare = false,
}: {
  n: number;
  noun: string;
  plural: string;
  bare?: boolean;
}) {
  return (
    <>
      <span className="nf-graph-value nf-num text-[var(--color-ink)]">{n}</span>{" "}
      {bare ? (n === 1 ? noun : plural) : n === 1 ? noun : plural}
    </>
  );
}
