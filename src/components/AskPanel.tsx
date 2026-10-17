"use client";

import { useEffect, useState } from "react";
import { answeredDepth, type AgentRun } from "./agent-transcript";

/**
 * Ask NexusForge.
 *
 * Suggested questions are the primary entry point because they are generated
 * from the loaded graph and therefore cannot promise something the data
 * cannot answer. Free text stays available but visually secondary.
 *
 * This is NOT a chat interface: there is no conversation history, and the
 * answer's job is to point you at the graph, not to replace it.
 */

interface Suggestion {
  id: string;
  text: string;
  intent: string;
  entityId?: string;
  basis: string;
}

interface AskAnswer {
  intent: string;
  text: string;
  focusEntityIds: string[];
  citedSourceIds: string[];
  supported: boolean;
}

interface AskResponse {
  question: string;
  resolved: { intent: string; rootEntityId: string | null; targetEntityId: string | null };
  answer: AskAnswer;
  agent?: AgentRun | null;
  agentError?: string | null;
  rateLimited?: boolean;
  visitorLimit?: number;
  usage?: { requests: number; totalTokens: number };
  mode: string;
  modelAvailable: boolean;
  latencyMs: number;
}

/** Say exactly which engine produced the answer. */
function provenance(mode: string): string {
  switch (mode) {
    case "deterministic":
      return "Computed directly from the graph. No language model was used.";
    case "deterministic-fallback":
      return "Computed directly from the graph. The model planner did not run.";
    case "model-planned":
      return "A model chose which graph tools to call. Every fact was read from FalkorDB.";
    default:
      return "Computed from the graph.";
  }
}

export function AskPanel({
  orgId,
  onFocusEntities,
  onInvestigate,
}: {
  orgId: string;
  onFocusEntities: (ids: string[]) => void;
  onInvestigate: (rootEntityId: string, depth: number) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setSuggestions([]);
    (async () => {
      try {
        const res = await fetch(`/api/ask?org=${encodeURIComponent(orgId)}`);
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setSuggestions(body.suggestions ?? []);
        setModelAvailable(body.modelAvailable === true);
      } catch {
        /* the panel is optional; the investigation works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  /**
   * Ask a question.
   *
   * `useModel` is an explicit, per-question opt in. The model planner costs
   * money and is rate limited, so it is never the silent default: the
   * deterministic answer is always computed first and is what you get unless
   * you deliberately choose otherwise.
   */
  const ask = async (question: string, useModel = false) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: orgId, question, useModel }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.code}: ${body.error}`);
        return;
      }
      setResult(body as AskResponse);
      // Focus the first entity the answer is actually about. The old
      // "Show N entities on the canvas" button did not load an
      // investigation, so it has been removed rather than left misleading.
      if (body.answer?.focusEntityIds?.length) {
        onFocusEntities(body.answer.focusEntityIds);
      }
      // Drive the central canvas with the same investigation, so the graph
      // shows what the answer is talking about instead of staying empty. The
      // depth comes from what was actually computed, never from the model's
      // prose or from the depth input the user happens to have sitting there.
      if (body.resolved?.rootEntityId) {
        onInvestigate(body.resolved.rootEntityId, answeredDepth(body.agent));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => ask(s.text)}
              title={s.basis}
              className="nf-anim min-h-11 w-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-left text-xs leading-snug hover:border-[var(--color-accent-dim)] disabled:opacity-50"
            >
              {s.text}
              <span className="mt-1 block text-[0.625rem] text-[var(--color-ink-faint)]">
                {s.basis}
              </span>
            </button>
          </li>
        ))}
        {suggestions.length === 0 && (
          <li className="text-xs text-[var(--color-ink-faint)]">Loading questions…</li>
        )}
      </ul>

      {/* Free text: available, deliberately secondary. */}
      <form
        className="mt-3 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) ask(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or ask about this graph…"
          className="min-h-10 min-w-0 flex-1 border border-[var(--color-line)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="min-h-10 shrink-0 border border-[var(--color-line-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-sev-high)]">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 border-l-2 border-[var(--color-accent-dim)] pl-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="nf-graph-value text-[0.625rem] uppercase text-[var(--color-ink-faint)]">
              {result.resolved.intent}
            </span>
            {!result.answer.supported && (
              <span className="text-[0.625rem] text-[var(--color-sev-warn)]">
                not supported by this graph
              </span>
            )}
            <span className="nf-graph-value nf-num ml-auto text-[0.625rem] text-[var(--color-ink-faint)]">
              {result.latencyMs} ms
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[var(--color-ink)]">
            {result.answer.text}
          </p>

          <p className="mt-1.5 text-[0.625rem] text-[var(--color-ink-faint)]">
            {provenance(result.mode)}
            {result.answer.citedSourceIds.length > 0 && (
              <> · {result.answer.citedSourceIds.length} source(s) cited</>
            )}
          </p>

          {/* The model's own investigation, shown as a separate, clearly
              labelled block so it can never be mistaken for the
              deterministic answer above. */}
          {result.agent && (
            <div className="mt-2.5 border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
              <p className="nf-graph-value text-[0.625rem] uppercase text-[var(--color-accent)]">
                Model-planned investigation
              </p>
              <p className="mt-0.5 text-[0.625rem] text-[var(--color-ink-faint)]">
                {result.agent.plannerLabel}
              </p>
              <ol className="mt-1.5 space-y-1">
                {result.agent.steps.map((s) => (
                  <li key={s.index} className="text-[0.625rem] leading-snug">
                    <span className="nf-graph-value text-[var(--color-ink-muted)]">
                      {s.index + 1}. {s.tool}
                    </span>
                    <span className="nf-num ml-1 text-[var(--color-ink-faint)]">
                      {s.durationMs} ms
                    </span>
                    <span className="block text-[var(--color-ink-faint)]">{s.summary}</span>
                  </li>
                ))}
              </ol>
              {result.agent.finalText && (
                <p className="mt-1.5 border-t border-[var(--color-line)] pt-1.5 text-xs leading-relaxed text-[var(--color-ink)]">
                  {result.agent.finalText}
                </p>
              )}
              {result.usage && (
                <p className="nf-num mt-1 text-[0.625rem] text-[var(--color-ink-faint)]">
                  {result.usage.requests} model request(s), {result.usage.totalTokens} tokens
                </p>
              )}
            </div>
          )}

          {result.agentError && (
            <p className="mt-2 text-[0.625rem] leading-relaxed text-[var(--color-sev-warn)]">
              {result.rateLimited
                ? `Model limit reached (${result.visitorLimit} per hour). The answer above is the deterministic one, computed from the graph.`
                : `Model planner unavailable. The answer above is the deterministic one, computed from the graph.`}
            </p>
          )}

          {/* Offer the paid path only after a free answer already exists. */}
          {modelAvailable && !result.agent && !result.agentError && (
            <button
              type="button"
              disabled={busy}
              onClick={() => ask(result.question, true)}
              className="nf-anim mt-2 min-h-9 border border-[var(--color-line-strong)] px-2.5 py-1 text-[0.625rem] text-[var(--color-ink-muted)] hover:border-[var(--color-accent-dim)] hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              Re-run as a model-planned investigation
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-[0.625rem] leading-relaxed text-[var(--color-ink-faint)]">
        {modelAvailable
          ? "Answers are computed deterministically from the graph. A model-planned investigation is available on request, rate limited, and reads the same graph through the same read-only tools."
          : "Answers are computed deterministically from the graph. The optional model planner is disabled in this deployment."}
      </p>
    </div>
  );
}
