"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalysisResponse,
  AuditEvent,
  EntityOption,
  ImpactedEntity,
  Proposal,
} from "./types";
import { Canvas } from "./Canvas";
import { Inspector, PathChain } from "./Inspector";
import { FindingsList } from "./Findings";
import { Proposals, AuditTrail } from "./Proposals";
import { AgentPanel } from "./AgentPanel";
import { Headline } from "./Headline";
import { AskPanel } from "./AskPanel";

/**
 * The investigation view.
 *
 * Three regions: narrative on the left, hop-column canvas in the centre, and
 * the Inspector sliding over the canvas on the right.
 *
 * Every number on this screen comes from the API, which computes it from
 * FalkorDB. There is no client-side fabrication and no placeholder data — if
 * a request fails, the failure is shown.
 */

interface LogEntry {
  at: string;
  label: string;
  detail: string;
  /** Expandable receipt body. */
  receipt?: string;
}

interface OrgInfo {
  id: string;
  label: string;
  sector: string;
  notice: string;
  headline: string;
}

export function Investigation() {
  const [orgId, setOrgId] = useState<string>("northstar");
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [rootId, setRootId] = useState<string>("");
  const [depth, setDepth] = useState<number>(6);

  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [canDecide, setCanDecide] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePathIndex, setActivePathIndex] = useState(0);
  /** How many hop columns are visible. Reveal only; never gates data. */
  const [revealedHops, setRevealedHops] = useState(99);
  const [revealing, setRevealing] = useState(false);
  /**
   * Which pane is visible below the lg breakpoint.
   *
   * The two panes stack on narrow screens, which pushed the graph off the
   * bottom of a phone entirely. A toggle shows one at a time; at lg and above
   * both are visible side by side exactly as before.
   */
  const [mobileView, setMobileView] = useState<"narrative" | "graph">("narrative");
  const [busy, setBusy] = useState(false);
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const addLog = useCallback((label: string, detail: string, receipt?: string) => {
    setLog((l) => [
      ...l,
      {
        at: new Date().toISOString().slice(11, 19),
        label,
        detail,
        ...(receipt ? { receipt } : {}),
      },
    ]);
  }, []);

  // Load the list of organizations once, for the switcher.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ask?org=northstar");
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setOrgs(body.organizations ?? []);
      } catch {
        /* the switcher is optional; the investigation works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Load the selected organization's entities.
   *
   * Switching organizations CLEARS every piece of investigation state first,
   * so no finding, proposal, trace or audit entry from one organization can
   * survive into another.
   */
  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setProposals([]);
    setAuditEvents([]);
    setSelectedId(null);
    setActivePathIndex(0);
    setCanDecide(false);
    setEntities([]);
    setRootId("");
    setLog([]);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/entities?org=${encodeURIComponent(orgId)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Could not load entities.");
          return;
        }
        setEntities(body.entities);
        setOrg(body.organization ?? null);
        const first = body.entities.find((e: EntityOption) => e.dependentCount > 0);
        if (first) setRootId(first.id);
        addLog(
          "graph connected",
          `${body.entities.length} entities · ${body.organization?.label ?? orgId}`,
          `GET /api/entities?org=${orgId} → 200\nentities: ${body.entities.length}`,
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, addLog]);

  const runAnalysis = useCallback(async () => {
    if (!rootId) return;
    setBusy(true);
    setError(null);
    setSelectedId(null);
    const started = Date.now();
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: orgId, rootEntityId: rootId, maxDepth: depth }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.code}: ${body.error}`);
        addLog("analysis failed", body.error, `HTTP ${res.status}\n${body.code}`);
        return;
      }
      const data = body as AnalysisResponse;
      setAnalysis(data);
      setProposals(data.proposals);
      setAuditEvents([]);
      setCanDecide(true);

      // Reveal the already-computed result hop by hop. This is exploration of
      // a finished analysis, never simulated computation: the data is already
      // in hand and the headline states the real elapsed time.
      const maxHop = Math.max(0, ...data.impacted.map((e) => e.shortestPath.edgeHops));
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reduced || maxHop === 0) {
        setRevealedHops(99);
        setRevealing(false);
      } else {
        setRevealedHops(0);
        setRevealing(true);
        for (let hop = 1; hop <= maxHop; hop += 1) {
          window.setTimeout(() => setRevealedHops(hop), hop * 220);
        }
        window.setTimeout(() => setRevealing(false), maxHop * 220 + 120);
      }

      addLog(
        "traversal complete",
        `${data.distinctImpactedCount} distinct entities via ${data.totalPathCount} paths`,
        [
          `POST /api/analysis → 200`,
          `root: ${data.root.entityId}`,
          `depth bound: ${data.maxDepth}`,
          `rule: ${data.ruleId}`,
          `distinct entities: ${data.distinctImpactedCount}`,
          `dependency paths: ${data.totalPathCount}`,
          `server time: ${data.latencyMs} ms`,
          `round trip: ${Date.now() - started} ms`,
        ].join("\n"),
      );

      const observed = data.impacted.filter((e) => e.claim === "OBSERVED").length;
      addLog(
        "claims classified",
        `${observed} observed, ${data.impacted.length - observed} derived`,
        `OBSERVED = one evidenced relationship\nDERIVED = chained conclusion`,
      );

      if (data.proposals.length > 0) {
        addLog(
          "proposals generated",
          `${data.proposals.length} from deterministic rules`,
          data.proposals.map((p) => `${p.ruleId} → ${p.targetEntityId}`).join("\n"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [rootId, depth, addLog, orgId]);

  const decide = useCallback(
    async (proposalId: string, decision: "APPROVED" | "REJECTED") => {
      setBusyProposal(proposalId);
      setError(null);
      try {
        const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org: orgId, decision }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(`${body.code}: ${body.error}`);
          addLog("decision rejected", body.error, `HTTP ${res.status}\n${body.code}`);
          return;
        }
        setProposals((ps) =>
          ps.map((p) => (p.proposalId === proposalId ? body.proposal : p)),
        );
        setAuditEvents((es) => [
          ...es.filter((e) => e.proposalId !== proposalId),
          ...body.auditEvents,
        ]);
        addLog(
          "decision recorded",
          `${decision.toLowerCase()} — not executed`,
          [
            `POST /api/proposals/.../decision → 200`,
            `transition: ${body.transition.fromState} → ${body.transition.toState}`,
            `audit event: ${body.transition.auditEventId}`,
            `executed: ${body.executed}`,
            body.semantics.approvedDoesNotMean,
          ].join("\n"),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyProposal(null);
      }
    },
    [addLog, orgId],
  );

  const selected: ImpactedEntity | null = useMemo(
    () => analysis?.impacted.find((e) => e.entityId === selectedId) ?? null,
    [analysis, selectedId],
  );

  /** Selecting a different entity always starts from its shortest route. */
  const selectEntity = useCallback((id: string) => {
    setSelectedId((prev) => {
      if (prev !== id) setActivePathIndex(0);
      return id;
    });
  }, []);

  const skipReveal = useCallback(() => {
    setRevealedHops(99);
    setRevealing(false);
  }, []);

  const rootOption = entities.find((e) => e.id === rootId);

  return (
    <div className="flex h-dvh flex-col bg-[var(--color-surface-0)]">
      <TopBar
        orgId={orgId}
        orgs={orgs}
        org={org}
        onOrgChange={setOrgId}
        entities={entities}
        rootId={rootId}
        onRootChange={setRootId}
        depth={depth}
        onDepthChange={setDepth}
        onRun={runAnalysis}
        busy={busy}
        analysis={analysis}
      />

      {error && (
        <div
          role="alert"
          className="border-b border-[var(--color-sev-high)] bg-[var(--color-surface-1)] px-5 py-2 text-sm text-[var(--color-sev-high)]"
        >
          {error}
        </div>
      )}

      {/* Pane toggle: narrow screens only. */}
      <div
        className="flex shrink-0 border-b border-[var(--color-line)] bg-[var(--color-surface-1)] lg:hidden"
        role="tablist"
        aria-label="Switch between the narrative and the graph"
      >
        {(["narrative", "graph"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={mobileView === v}
            onClick={() => setMobileView(v)}
            className={`nf-anim flex-1 border-b-2 px-3 py-2 text-xs capitalize ${
              mobileView === v
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-[var(--color-ink-muted)]"
            }`}
          >
            {v === "graph" ? "Graph" : "Findings"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* LEFT — narrative */}
        <div
          className={`nf-scroll w-full shrink-0 overflow-y-auto border-[var(--color-line)] p-5 lg:block lg:w-[23rem] lg:border-r ${
            mobileView === "graph" ? "hidden" : "block"
          }`}
        >
          {org && (
            <section className="mb-5 border border-[var(--color-line)] bg-[var(--color-surface-1)] p-3">
              <div className="text-sm font-medium">{org.label}</div>
              <div className="text-[0.6875rem] text-[var(--color-ink-faint)]">{org.sector}</div>
              <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-[var(--color-ink-faint)]">
                {org.notice}
              </p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              Ask NexusForge
            </h2>
            <AskPanel
              orgId={orgId}
              onFocusEntities={(ids) => {
                const first = ids[0];
                if (first) setSelectedId(first);
              }}
              onInvestigate={(id) => setRootId(id)}
            />
          </section>

          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              Question
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed">
              {rootOption ? (
                <>
                  If{" "}
                  <span className="nf-graph-value text-[var(--color-ink)]">
                    {rootOption.name}
                  </span>{" "}
                  changes or becomes unavailable, what is exposed, why, and on
                  what evidence?
                </>
              ) : (
                "Select an entity and run an analysis."
              )}
            </p>
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              Investigation log
            </h2>
            <InvestigationLog entries={log} />
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              Agent
            </h2>
            <AgentPanel rootEntityId={rootId} />
          </section>

          {analysis && (
            <>
              <section className="mt-6">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                  Findings
                </h2>
                <FindingsList
                  impacted={analysis.impacted}
                  proposals={proposals}
                  selectedId={selectedId}
                  onSelect={selectEntity}
                />
              </section>

              {/*
                Text equivalent of the canvas. Kept for screen readers and for
                anyone who would rather read the chains than pan a graph.
              */}
              <section className="mt-6">
                <details>
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Dependency chains (text)
                  </summary>
                  <ul className="mt-2 space-y-3">
                    {analysis.impacted.map((e) => (
                      <li
                        key={e.entityId}
                        className="border border-[var(--color-line)] p-2"
                      >
                        <div className="text-xs">{e.name}</div>
                        <PathChain entity={e} pathIndex={0} />
                      </li>
                    ))}
                  </ul>
                </details>
              </section>

              <section className="mt-6">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                  Proposed actions
                </h2>
                <Proposals
                  proposals={proposals}
                  auditEvents={auditEvents}
                  canDecide={canDecide}
                  busyId={busyProposal}
                  onDecide={decide}
                  onSelectTarget={selectEntity}
                />
              </section>

              <section className="mt-6">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                  Audit history
                </h2>
                <AuditTrail events={auditEvents} />
              </section>
            </>
          )}
        </div>

        {/* CENTRE — canvas, with the Inspector sliding over it */}
        <main
          className={`relative min-h-0 flex-1 overflow-hidden bg-[var(--color-surface-1)] lg:block ${
            mobileView === "narrative" ? "hidden" : "block"
          }`}
        >
          {analysis ? (
            <>
              <div className="flex h-full flex-col">
                <Headline
                  analysis={analysis}
                  proposals={proposals}
                  revealing={revealing}
                  onSkip={skipReveal}
                />
                {selectedId && (
                  <TraceBar
                    label={selected?.name ?? selectedId}
                    routeCount={selected?.allPaths.length ?? 1}
                    activeIndex={activePathIndex}
                    onClear={() => setSelectedId(null)}
                  />
                )}
                <div className="min-h-0 flex-1">
                  <Canvas
                    rootName={analysis.root.name}
                    rootEntityId={analysis.root.entityId}
                    rootEntityType={analysis.root.entityType}
                    impacted={analysis.impacted}
                    selectedId={selectedId}
                    activePathIndex={activePathIndex}
                    onSelect={selectEntity}
                    revealedHops={revealedHops}
                  />
                </div>
              </div>

              <Inspector
                entity={selected}
                rootEntityId={analysis.root.entityId}
                maxDepth={analysis.maxDepth}
                activePathIndex={activePathIndex}
                onSelectPath={setActivePathIndex}
                onClose={() => setSelectedId(null)}
              />
            </>
          ) : (
            <EmptyState busy={busy} />
          )}
        </main>
      </div>
    </div>
  );
}

function TopBar({
  orgId,
  orgs,
  org,
  onOrgChange,
  entities,
  rootId,
  onRootChange,
  depth,
  onDepthChange,
  onRun,
  busy,
  analysis,
}: {
  orgId: string;
  orgs: OrgInfo[];
  org: OrgInfo | null;
  onOrgChange: (v: string) => void;
  entities: EntityOption[];
  rootId: string;
  onRootChange: (v: string) => void;
  depth: number;
  onDepthChange: (v: number) => void;
  onRun: () => void;
  busy: boolean;
  analysis: AnalysisResponse | null;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-1)] px-5 py-3">
      <div className="mr-2">
        <div className="text-sm font-medium tracking-tight">NexusForge</div>
        <div className="text-[0.6875rem] text-[var(--color-ink-faint)]">
          evidence-backed organizational intelligence
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span>Organization</span>
        <select
          value={orgId}
          onChange={(e) => onOrgChange(e.target.value)}
          className="border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-ink)]"
        >
          {orgs.length === 0 && <option value={orgId}>loading…</option>}
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} · {o.sector}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span>Changed entity</span>
        <select
          value={rootId}
          onChange={(e) => onRootChange(e.target.value)}
          className="nf-graph-value max-w-xs border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-ink)]"
        >
          {entities.length === 0 && <option value="">loading…</option>}
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.type} ({e.dependentCount})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span>Depth</span>
        <input
          type="number"
          min={1}
          max={8}
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          className="nf-graph-value nf-num w-14 border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-ink)]"
        />
      </label>

      <button
        type="button"
        onClick={onRun}
        disabled={busy || !rootId}
        className="border border-[var(--color-accent-dim)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-surface-3)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Querying graph…" : "Run analysis"}
      </button>

      {analysis && (
        <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-ink-faint)]">
          <span className="nf-graph-value nf-num">
            {analysis.distinctImpactedCount} entities
          </span>
          <span className="nf-graph-value nf-num">{analysis.totalPathCount} paths</span>
          <span className="nf-graph-value nf-num">{analysis.latencyMs} ms</span>
        </div>
      )}
    </header>
  );
}

function InvestigationLog({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-[var(--color-ink-faint)]">
        Nothing yet. Run an analysis.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-baseline gap-2 border-l-2 border-[var(--color-line-strong)] py-0.5 pl-2 text-left hover:border-[var(--color-accent)]"
          >
            <span className="text-[var(--color-ink-faint)]" aria-hidden="true">
              {e.receipt ? (open === i ? "▾" : "▸") : "·"}
            </span>
            <span className="flex-1">
              <span className="text-xs text-[var(--color-ink)]">{e.label}</span>
              <span className="ml-1.5 text-xs text-[var(--color-ink-muted)]">
                {e.detail}
              </span>
            </span>
            <time className="nf-graph-value nf-num text-[0.6875rem] text-[var(--color-ink-faint)]">
              {e.at}
            </time>
          </button>
          {open === i && e.receipt && (
            <pre className="nf-scroll ml-2 mt-1 overflow-x-auto border border-[var(--color-line)] bg-[var(--color-surface-0)] p-2 text-[0.6875rem] text-[var(--color-ink-muted)]">
              <code className="nf-graph-value">{e.receipt}</code>
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Shown while a trace is active, so the dimmed canvas is never a mystery and
 * there is always an obvious way back to the whole network.
 */
function TraceBar({
  label,
  routeCount,
  activeIndex,
  onClear,
}: {
  label: string;
  routeCount: number;
  activeIndex: number;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-6 py-1.5">
      <p className="truncate text-xs text-[var(--color-ink-muted)]">
        <span className="text-[var(--color-accent)]">Tracing</span> {label}
        {routeCount > 1 && (
          <span className="nf-graph-value nf-num ml-2 text-[var(--color-ink-faint)]">
            route {activeIndex + 1} of {routeCount}
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 border border-[var(--color-line-strong)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        Clear trace
      </button>
    </div>
  );
}

function EmptyState({ busy }: { busy: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-sm text-[var(--color-ink-muted)]">
          {busy
            ? "Running a bounded multi-hop traversal against FalkorDB…"
            : "Select a changed entity and run an analysis."}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Results are computed from dependency relationships in the graph. A
          dependency path proves exposure to a change, not operational failure.
        </p>
      </div>
    </div>
  );
}
