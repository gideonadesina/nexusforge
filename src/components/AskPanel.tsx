"use client";

import { useEffect, useState } from "react";

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
  mode: string;
  modelAvailable: boolean;
  latencyMs: number;
}

export function AskPanel({
  orgId,
  onFocusEntities,
  onInvestigate,
}: {
  orgId: string;
  onFocusEntities: (ids: string[]) => void;
  onInvestigate: (rootEntityId: string) => void;
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

  const ask = async (question: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: orgId, question }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.code}: ${body.error}`);
        return;
      }
      setResult(body as AskResponse);
      if (body.answer?.focusEntityIds?.length) {
        onFocusEntities(body.answer.focusEntityIds);
      }
      if (body.resolved?.rootEntityId) {
        onInvestigate(body.resolved.rootEntityId);
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
              className="nf-anim w-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-left text-xs leading-snug hover:border-[var(--color-accent-dim)] disabled:opacity-50"
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
          className="min-w-0 flex-1 border border-[var(--color-line)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="shrink-0 border border-[var(--color-line-strong)] px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
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
            {result.mode === "deterministic"
              ? "Computed directly from the graph. No language model was used."
              : `Model-planned tool calls; all facts still read from FalkorDB.`}
            {result.answer.citedSourceIds.length > 0 && (
              <> · {result.answer.citedSourceIds.length} source(s) cited</>
            )}
          </p>

          {result.answer.focusEntityIds.length > 0 && (
            <button
              type="button"
              onClick={() => onFocusEntities(result.answer.focusEntityIds)}
              className="mt-1.5 text-[0.625rem] text-[var(--color-accent)] hover:underline"
            >
              Show {result.answer.focusEntityIds.length} entities on the canvas →
            </button>
          )}
        </div>
      )}

      {!modelAvailable && (
        <p className="mt-3 text-[0.625rem] leading-relaxed text-[var(--color-ink-faint)]">
          Answers are computed deterministically from the graph. The optional
          model planner is disabled in this deployment.
        </p>
      )}
    </div>
  );
}
