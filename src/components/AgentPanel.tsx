"use client";

import { useEffect, useState } from "react";

/**
 * Agent investigation transcript.
 *
 * The honesty rule this component exists to enforce: scripted behaviour is
 * labelled as scripted, prominently, and never dressed up as model reasoning.
 */

interface Step {
  index: number;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  ok: boolean;
  summary: string;
  durationMs: number;
  error?: string;
}

interface AgentResult {
  goal: string;
  mode: "scripted" | "llm";
  plannerLabel: string;
  steps: Step[];
  stoppedBecause: string;
  totalMs: number;
  canApprove: false;
}

export function AgentPanel({
  orgId,
  rootEntityId,
}: {
  /** Required: an agent request without it could target the wrong graph. */
  orgId: string;
  rootEntityId: string;
}) {
  const [result, setResult] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Clear any previous transcript when the organization changes, so a
  // Northstar investigation can never sit under an Education header.
  useEffect(() => {
    setResult(null);
    setError(null);
    setOpen(null);
  }, [orgId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: orgId, rootEntityId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.code}: ${body.error}`);
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy || !rootEntityId}
        className="w-full border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Investigating…" : "Run agent investigation"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-sev-high)]">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          {/* The label is not a footnote. It sits above the transcript. */}
          <div
            className={`mb-2 border-l-2 px-2 py-1 text-xs ${
              result.mode === "scripted"
                ? "border-[var(--color-sev-warn)] text-[var(--color-sev-warn)]"
                : "border-[var(--color-accent)] text-[var(--color-accent)]"
            }`}
          >
            {result.mode === "scripted" ? (
              <>
                <strong>Scripted procedure</strong> — a fixed investigation
                sequence, not a language model. Deterministic: the same graph
                produces the same transcript.
              </>
            ) : (
              <>
                <strong>Model planner</strong> — tool choices made by a language
                model, constrained to fixed query templates.
              </>
            )}
          </div>

          <p className="mb-2 text-xs text-[var(--color-ink-muted)]">{result.goal}</p>

          <ol className="space-y-1">
            {result.steps.map((s) => (
              <li key={s.index}>
                <button
                  type="button"
                  onClick={() => setOpen(open === s.index ? null : s.index)}
                  aria-expanded={open === s.index}
                  className="flex w-full items-baseline gap-2 border-l-2 border-[var(--color-line-strong)] py-0.5 pl-2 text-left hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-ink-faint)]" aria-hidden="true">
                    {open === s.index ? "▾" : "▸"}
                  </span>
                  <span className="flex-1">
                    <span className="nf-graph-value text-[var(--color-ink)]">{s.tool}</span>
                    {!s.ok && (
                      <span className="ml-2 text-xs text-[var(--color-sev-high)]">
                        {s.error ?? "failed"}
                      </span>
                    )}
                  </span>
                  <span className="nf-graph-value nf-num text-[0.6875rem] text-[var(--color-ink-faint)]">
                    {s.durationMs}ms
                  </span>
                </button>

                {open === s.index && (
                  <div className="ml-2 mt-1 space-y-1.5 border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
                    <p className="text-xs italic text-[var(--color-ink-muted)]">
                      {s.rationale}
                    </p>
                    <div>
                      <div className="text-[0.6875rem] uppercase text-[var(--color-ink-faint)]">
                        arguments (Zod-validated)
                      </div>
                      <pre className="nf-scroll overflow-x-auto text-[0.6875rem] text-[var(--color-ink-muted)]">
                        <code className="nf-graph-value">
                          {JSON.stringify(s.args, null, 1)}
                        </code>
                      </pre>
                    </div>
                    <div>
                      <div className="text-[0.6875rem] uppercase text-[var(--color-ink-faint)]">
                        result
                      </div>
                      <p className="nf-graph-value text-[0.6875rem] leading-relaxed text-[var(--color-ink-muted)]">
                        {s.summary}
                      </p>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <dl className="mt-2 space-y-0.5 border-t border-[var(--color-line)] pt-2 text-[0.6875rem] text-[var(--color-ink-faint)]">
            <div className="flex gap-2">
              <dt>stopped</dt>
              <dd className="nf-graph-value">{result.stoppedBecause}</dd>
            </div>
            <div className="flex gap-2">
              <dt>total</dt>
              <dd className="nf-graph-value nf-num">{result.totalMs} ms</dd>
            </div>
          </dl>

          <p className="mt-2 border-l-2 border-[var(--color-line-strong)] pl-2 text-[0.6875rem] leading-relaxed text-[var(--color-ink-muted)]">
            The agent has no approve or reject tool. It can investigate and
            explain; only a person holding this run&apos;s owner token can
            record a decision.
          </p>
        </div>
      )}
    </div>
  );
}
