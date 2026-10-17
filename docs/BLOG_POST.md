# The contract nobody knew was at risk

### An AI gateway fails. Four relationships away, a customer obligation is exposed. Here is how we found it.

<!-- SCREENSHOT 1: hero, full width -->

An AI inference gateway goes down. The on-call engineer opens the service
catalogue and checks what calls it: two services, both degraded, both already
alerting. Thirty minutes later the gateway is healthy again and the incident
is closed.

Three weeks after that, the quarterly compliance evidence build fails.

It fails because the audit ledger has a thirty minute hole in it. The ledger
has a hole because the audit processor consumes an event stream the gateway
publishes, and when the gateway stopped, that stream went quiet. Not an error.
Just silence. And because an enterprise customer's master services agreement
requires complete compliance evidence for every inference performed on their
data, a thirty minute outage three weeks ago is now a contractual problem.

Nothing in that chain is hidden. Every link is written down somewhere: an
event contract, a design note, a compliance policy, a signed agreement. The
problem is that no single document contains the chain, and no query you would
think to run reveals it.

I built NexusForge for Graph Hacks 2026 to find exactly this class of
consequence. This is how it works, and what went wrong on the way.

---

## Why direct lookup loses

Most organizational tooling is built on rows. You ask "what depends on the
inference gateway" and you get the answer the schema was designed to give you:
the things with a foreign key pointing at it. Direct consumers. One hop.

That answer is correct and useless. The consequential dependencies are rarely
the ones someone remembered to model as a direct link. They are:

- **Asynchronous.** A producer and a consumer that never call each other.
- **Derived.** An artefact built from data that only existed because something
  upstream was running.
- **Contractual.** An obligation that depends on an artefact that depends on a
  process that depends on a system.

Each hop is mundane. The composition is not.

Composition is exactly what a relational query is bad at. Every extra hop is
another join, the query gets longer and more brittle, and crucially you have to
*know which joins to write*. You cannot join your way to a consequence you have
not already imagined.

<!-- IMAGE: docs/assets/lookup-vs-traversal.svg, full width -->

A graph inverts that. You do not describe the shape of the answer. You give a
starting point, a relationship type and a bound, and the data tells you how far
the consequence reaches.

```cypher
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
```

That single pattern is the product. Everything else is plumbing around it.

## Why FalkorDB

Three properties decided it.

**Variable length traversal is a first-class operation.** `*1..6` is not a
recursive CTE or an application-side loop. It is the query.

**Relationship identity survives the traversal.** I can ask for the exact
relationship ids a path walked:

```cypher
RETURN [r IN relationships(p) | r.id] AS pathRelIds
```

This mattered more than I expected. It is what lets the interface draw an arrow
and then prove that arrow corresponds to a specific row in the database. Every
edge on screen is checkable, which turns a diagram into evidence.

**`GRAPH.RO_QUERY` is enforced server side.** The read path uses it
exclusively. I tested that rather than trusting it:

```
graph.RO_QUERY is to be executed only on read-only queries
```

That is the real server response to a `CREATE` issued on the read channel. The
test asserts it for `CREATE`, `SET`, `DELETE` and `MERGE`, each followed by a
check that the graph is unchanged afterwards. Rejection and non-mutation are
different claims and I verify both.

## Modelling Northstar Labs

Northstar Labs is a synthetic technology operations company. No real
organization is represented, and every node carries `synthetic: true`.

The schema is deliberately thin. One node label for organizational things:

```
(:Entity { id, type, name, intermediary, domain, synthetic })
```

A `type` property rather than a label per kind. That one decision is what keeps
the engine sector agnostic: the traversal does not know what a `Service` or an
`Obligation` is, so swapping sectors means new seed data, not new queries. I
proved it by running a synthetic school on the same engine with zero code
changes.

One relationship type, with a strict direction rule:

```
(dependent)-[:DEPENDS_ON]->(dependency)
```

Edges point from the thing that depends toward the thing it depends on. Impact
therefore propagates the *other* way, and impact discovery walks the edges in
reverse.

This caused more confusion during development than any other decision. I
eventually stopped hoping arrows would be self evident and made the interface
state it outright: the arrowhead shows the stored direction, because that is
the verifiable fact, and the legend says impact flows the opposite way.

Evidence is a node, not a blob:

```
(:Source { id, reference, excerpt, sourceType })
(:Entity)-[:EVIDENCED_BY]->(:Source)
```

Every dependency edge also carries a `sourceId`. This is the part that makes
output defensible. A finding is not "the system thinks X". It is "here is the
chain, here is the document behind each link, here is the verbatim sentence".

## The Meridian chain

Rooted at the gateway, the traversal finds **10 distinct exposed entities
across 12 dependency paths**, in about 40 ms of server time.

The interesting one is four hops out.

<!-- IMAGE: docs/assets/meridian-chain.svg (animated), full width -->

Four relationships, each with a real id, each backed by a source record. There
is a test asserting there is **no** direct edge between the contract and the
gateway, because a shortcut dressed up as a discovery would be worthless:

```cypher
MATCH (a:Entity {id:'ns_commitment_meridian'})
      -[r:DEPENDS_ON]->
      (b:Entity {id:'ns_svc_inference_gateway'})
RETURN count(r) AS c   // asserted to be 0
```

The finding exists only as a composition. That is the whole point.

<!-- SCREENSHOT 2: Trace on the Meridian finding, full width -->

## Counting things correctly is harder than finding them

Two problems appeared immediately, and both produce confident wrong answers
rather than crashes, which is the worse failure mode.

**Cycles.** The education graph contains a governance loop: a coordination
responsibility is mandated by a committee, and the committee discharges that
mandate through the responsibility. openCypher's relationship uniqueness rule
prevents infinite traversal, but it still admits trails that *revisit a node*
by a different edge, which inflates results plausibly enough that you might not
notice. I added an explicit node distinctness predicate:

```cypher
WHERE ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
```

**Multiple routes to one entity.** The compliance obligation is reachable two
ways: through the audit ledger, and directly through the audit processor,
because the policy requires both that the ledger exist and that the processor
ran continuously. Both routes are real. The entity is still *one* exposed
entity.

So the engine returns one row per route and collapses them in application code,
keyed on a path signature. `distinctImpactedCount` and `totalPathCount` are
reported as separate numbers and never conflated. Alternative routes stay
inspectable, because "there are two ways this breaks" is useful even though it
is one thing breaking.

I also wrote a second, differently shaped query whose only job is to disagree
with the first if I got it wrong:

```cypher
MATCH (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
RETURN count(DISTINCT affected.id) AS distinctCount
```

No path binding, no predicate. If the two ever disagree, one is broken. The
test asserts agreement rather than trusting either alone.

## The decoys

A traversal that returns everything is as useless as one that returns nothing,
so the seed contains deliberate traps. Northstar has a billing API, a billing
database, a model registry, an artifact store, and a `billing.events` topic.

That last one matters most. It is *structurally identical* to the real
`inference.events` topic: produced by a service, consumed downstream. If
exclusion were a naming heuristic it would fail here.

None of them have a dependency route to the gateway. All of them are excluded.
The education graph does the same thing with an `SS1 Physics` class taught by a
different teacher: keyword search returns it, dependency traversal does not.

## Saying "I do not know" properly

This is the part I got wrong first, and the correction changed the product.

My initial implementation labelled every discovered entity `OBSERVED`. An
independent audit pointed out this was false in two distinct ways.

A four hop reachability conclusion is not an observation. No record in the
graph says "the Meridian contract depends on the inference gateway". The engine
*derived* it by chaining four relationships. Calling that observed collapses
the exact distinction the product exists to maintain.

Worse, an entity whose edge cited a source that did not exist was still being
reported as observed fact. That is an unsupported conclusion wearing the
costume of evidence.

The fix separates two questions I had been treating as one:

| Axis | Question |
| --- | --- |
| `claim` | How was this established? `OBSERVED` for one evidenced relationship, `DERIVED` for a chained conclusion. |
| `evidenceStatus` | Is it supported? `COMPLETE`, `PARTIAL` or `MISSING`, assessed **per edge**, because a route is only as supported as its weakest link. |

A one hop dependency whose evidence does not resolve degrades to `DERIVED` with
`supported: false`. It does not get to be a fact just because it is close.

On the Northstar scenario this yields **3 OBSERVED and 7 DERIVED**, where
previously all 10 were mislabelled.

The scenario includes a deliberate gap to exercise this. The external failover
plan cites architecture decision ADR-014, and that source record does not exist
in the graph. The domain pack declares the dangling reference explicitly, so
seed validation still catches typos while allowing a documented hole:

```ts
export const DANGLING_SOURCE_IDS = ["src_ns_adr_014_current_status"] as const;
```

The result: the failover plan is one hop from the gateway, and the system still
refuses to call it observed. It is marked `MISSING`, `supported: false`, and
the unresolved reference is named in the interface. The only action proposed
for it is closing the evidence gap.

<!-- SCREENSHOT 3: Inspector with evidence and unresolved references, full width -->

There is a second gap of a different kind. The on-call roster covering gateway
failover names an engineer who left on 2026-09-30, and records no deputy.
NexusForge reports the unresolved responsibility. It does not suggest a
replacement, because nothing in the graph supports one.

A tool that invents a qualified substitute here is not being helpful. It is
being wrong with confidence, which is worse than being silent.

## Proposals, decisions, and the word "executed"

Findings are only useful if someone can act on them, so the engine generates
action proposals from deterministic versioned rules. The rules reason about
graph structure only, which is why they work across sectors:

- `rule.action.cover-direct-dependency@1` fires for entities one relationship
  from the change.
- `rule.action.resolve-evidence-gap@1` fires where evidence does not resolve.

On a fully evidenced graph the second rule produces nothing, which is the
correct data driven outcome rather than a guaranteed talking point.

The audit caught a real failure of judgement here too. I was proposing
`REASSIGN_DEPENDENCY` for the failover plan: telling an operator to decide a
replacement for a dependency I could not actually evidence. Advice built on
nothing. Operational proposals are now suppressed for unsupported findings.
They get the evidence gap proposal and nothing else.

The state machine is deliberately tiny: `PROPOSED` to `APPROVED` or `REJECTED`.
There is no `EXECUTED` and no `VERIFIED`, because the system performs no
external action and cannot confirm one. Modelling those states would be a lie
encoded in the schema.

Authorization lives inside the mutating statement rather than beside it:

```cypher
MATCH (run:AnalysisRun {analysisRunId: $runId, ownerTokenHash: $ownerTokenHash})
MATCH (p:ActionProposal {proposalId: $proposalId})-[:PROPOSED_IN]->(run)
WHERE p.state = $fromState
SET p.state = $toState, p.decidedAt = $now, p.decidedBy = $actor
CREATE (a:AuditEvent { auditEventId: $auditEventId, fromState: $fromState,
                       toState: $toState, at: $now, actor: $actor })
MERGE (a)-[:ABOUT_PROPOSAL]->(p)
MERGE (a)-[:IN_RUN]->(run)
```

Ownership, run membership, expected prior state, the state change and the audit
event are one statement. If the first match binds nothing, nothing downstream
happens. A wrong token and a repeated transition fail identically and write
nothing, so there is no check then write window and no way for state and audit
to disagree.

A run id is an identifier, not a credential. Mutating a run also requires an
opaque 32 byte owner token, of which only the SHA-256 hash is stored.

Every transition returns `executed: false`, and the caveat is rendered as part
of the approval control rather than hidden in a footnote. Approval is a
decision. It is not a thing that happened.

<!-- SCREENSHOT 4: proposals and the approval bar, inline -->

## The agent, and what it is not allowed to do

There is a bounded agent layer that can investigate the graph and explain what
it finds. Its constraints are structural rather than prompted, because a
constraint that lives in a prompt is a suggestion:

- No tool accepts Cypher, so an agent cannot compose a query.
- No approve or reject tool exists, so authority stays with the token holder.
- No tool writes at all.
- Every tool input is Zod validated before execution.
- Budgets, timeouts and call caps sit outside the planner, so swapping in a
  model cannot relax them.

The cumulative token budget lives in FalkorDB and is incremented atomically,
not held in process memory. On serverless infrastructure a process local
counter means every cold start gets a fresh budget, which is to say no budget
at all.

Two planners exist. The scripted one is deterministic and is labelled in the
interface as a scripted procedure, never as reasoning. The route that runs it
reports its own mode as `scripted` unconditionally, because it only ever
constructs that planner. It used to report `llm` whenever an API key happened
to be present, which would have claimed model reasoning for a procedure that
does no reasoning at all, the moment a key was added.

The second planner is a GPT-6 Luna model driving the same read-only tools
through the Responses API. A controlled run costs three model requests and
about 2,700 tokens.

The most useful thing the model did was fail honestly. Given the tools, it
chose `list_entities`, then `analyse_impact` with a depth of 8, which is its
own choice rather than the scripted default of 6. Then it stopped and said it
could not name the exposed entities. It was right: the tool's text summary
reported only counts, and the summary is the only part of a tool result the
model sees. With no entity id to pass, it could not call `explain_path`, and
it declined to invent one. A plausible-looking fabricated id is exactly the
failure this project exists to avoid, and the model refused to produce one.
The scripted planner never hit this, because it reads the structured result
out of the loop state. The gap survived until a model drove the
investigation, which is a reasonable argument for having both.

The fix was to make the tool name what it found rather than only counting it.

Paid inference runs behind two switches, not one: a key must be present **and**
an explicit flag must be on, so a key alone can never start billing. Spending
is capped two ways. A global ledger in FalkorDB caps tokens and requests per
rolling window, incremented atomically, because a process-local counter on
serverless means a fresh budget on every cold start. A per-visitor limit sits
on top, since a global cap alone does not stop one caller consuming the whole
day's allowance. When either limit is reached, the model path silently stops
and the deterministic answer is what you get, which is the same answer the
rest of the site is built on.

## Three bugs worth describing

### The one value we interpolate

openCypher will not accept a parameter inside `*1..n`, so the traversal depth
is the single value that reaches a query by string concatenation. It is
validated with Zod, and coercion is refused entirely:

```ts
z.number().int().min(1).max(8)   // no coercion: "3" is rejected
```

Because no string is ever accepted, `"3 OR 1=1"` and
`"2; MATCH (n) DETACH DELETE n"` are rejected structurally rather than
filtered. Tests assert that **zero** graph queries are issued for invalid
input, because rejecting late is not the same as rejecting early.

### A read operation that wrote

Two agent read tools called a seed-if-missing helper that defaulted to the
education domain pack. Against a correctly seeded Northstar graph, the
education version check failed, and a *read* would seed education data into
Northstar.

Three things combined to allow it: a convenience default, a tool that could
write, and a kill switch defaulting to on because "the scripted planner makes
no paid calls". Free of cost is not the same as safe.

The fix removed seeding from the tool surface entirely, made the domain pack a
required argument so omitting it is a compile error, and flipped the kill
switch to default off. The compiler then found every unsafe call site, which is
exactly the outcome you want from that kind of change.

### Then I made it worse

While verifying containment, I sent a probe request to the production agent
endpoint **before deploying the fix**. That request executed the exact defect
and contaminated the Northstar graph: 18 entities became 35.

Recovery was a read-only inventory that classified every node by explicit
manifest membership rather than by a `domain` property, a dry run, then
surgical deletion that preserved all three existing analysis runs and their
findings. Both graphs are clean, and the inventory script is in the repository.

The lesson is unglamorous and worth stating plainly: deploy the fix before you
test whether the fix is deployed.

There was a fourth, smaller one. During the final pre-publication security
audit, git reported the FalkorDB client module as binary. A single stray NUL
byte, introduced by a scripted edit, had made the credential handling file
invisible to every text based secret scanner. Nothing leaked, and a value based
scan confirmed it. But "the scanner reported clean" means nothing if the
scanner silently skipped the one file that mattered most.

## What I would do next

**Key path signatures on relationship ids, not node ids.** Two parallel edges
between the same pair currently collapse into one stored route. Entity counts,
claims and evidence stay correct, and the seeds provably contain no parallel
edges, so I documented it with a test rather than fixing it under deadline. It
is the first thing to repair.

**A real mobile graph view.** The canvas now renders at every viewport with a
pane toggle and tap to trace, which makes it reachable. It is not designed for
a phone. Vertical hop stacking and pinch zoom would be.

**Finding verification.** `VERIFIED` exists in the type and is never set,
guarded by an invariant that refuses to mark an unsupported finding verified.
Earning that status requires independent re-checks per finding type, which is
real work rather than a flag flip.

## On AI assistance

The hackathon requires disclosure, and it is worth being specific rather than
waving at it.

The implementation was written by Claude Code working from my direction. I set
the architecture and the constraints that shaped it: FalkorDB as the only
datastore, the dependency direction rule, the distinction between observed and
derived claims, the refusal to model execution states the system cannot honour,
and the rule that nothing ships as verified unless a test proves it against a
real database.

I also directed the product decisions: leading with Northstar rather than the
education scenario, treating evidence gaps as findings rather than omissions,
and the repeated instruction that a feature which cannot be demonstrated
honestly should be disabled rather than dressed up.

Two independent audit passes by a separate reviewer found the defects described
above. Those audits were the most valuable input the project received, and
several findings were failures of judgement rather than typos, which is exactly
the category a confident implementer is worst at catching in their own work.

Every figure in this article came from execution against a real FalkorDB
instance. Where something is unverified, the repository says so.

---

**Live demo:** https://nexusforge-ten.vercel.app
**Source:** https://github.com/gideonadesina/nexusforge

Built for Graph Hacks 2026, powered by FalkorDB.
