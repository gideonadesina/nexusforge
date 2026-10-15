# NexusForge — demo video script (90–120s)

**Every number below was observed on the deployed site.** Re-check them before
recording; if the graph or timings change, change the script, not the facts.

Live: <https://nexusforge-ten.vercel.app>

Observed on 2026-10-15 (Northstar Labs, depth bound 6):

| Figure | Observed value |
|---|---|
| Distinct exposed entities | 10 |
| Dependency paths | 12 |
| Server analysis time | 39–40 ms |
| FalkorDB health round trip | 3 ms |
| Meridian commitment distance | 4 edge hops |
| Proposals generated | 7 (4 reassign, 3 evidence-gap) |

---

## 0:00–0:15 — What this is

> "An AI inference gateway goes down. The on-call engineer checks the services
> that call it. What they will not check is a customer contract four
> relationships away — because nothing links them directly.
>
> NexusForge is an evidence-backed organizational intelligence engine built on
> FalkorDB. It finds those paths, and it proves them."

*Screen: landing view, Northstar Labs loaded, organization name and the
synthetic-data notice visible.*

## 0:15–0:30 — Ask a real question

> "Northstar Labs is a synthetic technology-operations organization. The
> suggested questions are generated from the graph that is actually loaded, so
> the system can only offer what it can answer."

*Click: "What is exposed if AI Inference Gateway becomes unavailable?"*

> "Analysis complete in forty milliseconds. Ten exposed entities across twelve
> dependency paths — computed by FalkorDB, not retrieved from a cache."

*Screen: headline showing the real latency, then the hop-column reveal.*

## 0:30–0:50 — The finding nobody expected

> "One hop out: the services you would check. But follow the chain."

*Click the Meridian Health commitment. Trace highlights the path and dims the rest.*

> "A customer contract clause, four hops from the outage. The gateway publishes
> to an event topic. An audit processor consumes it. The audit ledger is built
> from that. Quarterly compliance evidence comes from the ledger. And Meridian's
> master services agreement requires that evidence.
>
> No direct edge exists between the gateway and the contract. The traversal
> found it."

*Screen: the traced path in teal, everything else at 25%.*

## 0:50–1:10 — The evidence, and what we do not know

> "Every link is backed by a source record."

*Open the Inspector; scroll to evidence.*

> "Here is the event contract, the audit design note, the compliance policy,
> the signed MSA clause. Verbatim excerpts, not summaries. The Inspector also
> shows the exact Cypher template and the bound parameters — you can re-run it
> yourself.
>
> And here is what NexusForge will not do."

*Click the external failover plan — dashed border, hollow.*

> "The recovery plan cites an architecture decision whose current status cannot
> be found. So this finding is marked unsupported, with the missing reference
> named. It is one hop away, but it is not labelled OBSERVED, because the
> evidence does not resolve. The system proposes closing that gap — not a
> workaround built on a document nobody can produce."

*Also show: the on-call assignment, whose roster excerpt names a departed
engineer and no deputy. "It reports the gap. It does not invent a replacement."*

## 1:10–1:30 — A controlled decision

> "Seven actions are proposed by versioned deterministic rules."

*Approve one.*

> "Approved — and recorded as an append-only audit event. Note the wording:
> approval is a decision, not an execution. NexusForge performs no external
> action and says so in the response payload. Only the browser holding this
> run's owner token can decide; anyone else gets a 403."

## 1:30–1:50 — Why FalkorDB

> "This is not a database doing storage. The product *is* the traversal: a
> bounded, cycle-safe, multi-hop Cypher query over typed dependency edges,
> returning the exact relationship ids so the interface can draw and prove
> every arrow.
>
> Entities, evidence, findings, proposals, approvals and the audit trail all
> live in FalkorDB. There is no second datastore. Switch to the education
> organization and you get a completely separate graph — same engine, zero
> shared data."

*Switch organizations to show the engine is not sector-specific.*

## 1:50–2:00 — Close

> "A dependency path proves exposure, not failure — and NexusForge is careful
> about the difference. Findings are classified by how they were established,
> evidence gaps are stated rather than smoothed over, and nothing is ever
> reported as done when it was only approved."

---

## Recording checklist

- [ ] Re-run the analysis and update any number that changed.
- [ ] Hard-refresh so the reveal animation plays from the start.
- [ ] Have the Inspector scrolled to evidence before recording that beat.
- [ ] Do not show the `.env.local` file, terminal with credentials, or the
      Vercel dashboard.
- [ ] If the DNS fault hits on first load, retry before recording — do not
      narrate over an error state.

## Claims to avoid

- Do not say "real-time monitoring" — there is no live telemetry.
- Do not say the agent "decided" anything — it has no approval tool.
- Do not imply the system executed a recovery action.
- Do not quote a cost-per-query figure; none has been measured.
