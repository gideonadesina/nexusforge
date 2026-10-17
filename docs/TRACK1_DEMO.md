# Track 1 demonstration: agents acting on connected data

Everything here is a recorded result, not a mock-up. Figures come from the
runs logged below and can be reproduced with the commands given.

## What the two routes actually are

Getting this distinction right matters more than the demo looking impressive,
because conflating them is the easiest way to lose credibility with a judge
who checks.

| | `/api/agent` | `/api/ask` |
| --- | --- | --- |
| Planner | Scripted procedure | GPT-6 Luna, Responses API |
| Reasoning | **None.** Deterministic rules | The model chooses each tool call |
| Reports its mode as | `scripted`, always | `model-planned`, or `deterministic-fallback` |
| Cost | Free | Metered, capped, rate limited |
| Tools | The same five read-only tools | The same five read-only tools |

Both planners drive **the same read-only tool surface**. No tool accepts
Cypher, none writes, and no approve or reject tool exists, so neither planner
can act on the organization. That is the point of the track: the agent acts on
connected data by *reading* it, and authority to change anything stays with a
human.

`/api/agent` reports `mode: "scripted"` unconditionally. It previously
reported `"llm"` whenever an API key was present, which would have claimed
model reasoning for a procedure that does none.

## The verified model transcript

Command, against the real Northstar graph:

```bash
npx tsx scripts/paid-agent-test.ts --spend
```

Question asked:

> What is exposed if the AI inference gateway becomes unavailable, which
> findings are not backed by resolvable evidence, and what should a human
> decide?

**Step 1.** The model chose `list_entities` with `minDependents: 0`.
Returned 18 entities, `ns_svc_inference_gateway` carrying 4 direct dependents.

**Step 2.** The model chose `analyse_impact` with
`rootEntityId: "ns_svc_inference_gateway"` and `maxDepth: 8`. The depth is the
model's own choice; the scripted planner uses 6. Result: **10 distinct exposed
entities via 12 paths, 3 OBSERVED, 7 DERIVED, 3 with unresolved evidence.**

**Step 3.** The model stopped and reported that it could not name the exposed
entities, because the tool summary gave it counts and no ids. It declined to
invent one.

That was a real defect in the tool, not in the model. `analyse_impact` now
lists every exposed entity with hop distance, claim class and evidence status.

### Why the honest failure is the better story

The model had an obvious cheap option: guess an entity id that looked like the
others and call `explain_path` with it. It would have produced a confident,
well-formatted, completely fabricated answer. It said it could not instead.

## The production run, after the fix

Against the live public deployment, over HTTPS, exactly as a visitor's browser
reaches it:

```bash
npx tsx scripts/prod-smoke-test.ts --spend
```

**Step 1.** `list_entities`, `minDependents: 0`. 18 entities.

**Step 2.** `analyse_impact`, `rootEntityId: "ns_svc_inference_gateway"`,
`maxDepth: 8`. The depth is the model's own choice. 10 exposed entities, 12
paths, 3 OBSERVED, 7 DERIVED, 3 with unresolved evidence.

**Step 3.** `get_evidence` on `ns_plan_failover_external`. This is the
interesting one. Given ten entities it could have inspected, the model picked
one of the three flagged UNSUPPORTED rather than one of the seven with
complete evidence. The tool returned: *"No evidence resolved. Treat as
unsupported."*

**Final answer:**

> A change to `ns_svc_inference_gateway` exposes 10 distinct entities through
> 12 paths (within depth 8): 3 OBSERVED and 7 DERIVED. Three findings have
> unresolved evidence: `ns_assign_oncall_gateway` (PARTIAL, UNSUPPORTED),
> `ns_plan_failover_external` (MISSING, UNSUPPORTED), and
> `ns_resp_gateway_failover` (PARTIAL, UNSUPPORTED). The evidence lookup for
> `ns_plan_failover_external` resolved no evidence; treat it as unsupported.
> The other seven exposed entities have COMPLETE evidence.

**4 model requests, 3,722 input + 263 output = 3,985 tokens, 8.7 seconds,
$0.000504.** Graph census byte-identical before and after: 18 entities, 8
sources, 16 dependencies, 9 runs, 90 findings, 57 proposals.

The behaviour worth pointing at in the film is step 3. Nothing instructed the
model to prioritise weak evidence. It was given ten entities with their
evidence status and it went to a gap.

## The deterministic investigation, for comparison

```bash
npx tsx scripts/verify-summary.ts
```

Seven steps, about 15 seconds, no model, and it reaches this conclusion:

> A change to AI Inference Gateway exposes 10 distinct entities across 12
> dependency paths, within a depth bound of 6. 4 depend on it directly; 6 are
> reached only through intermediaries. The most distant exposure is Meridian
> Health MSA, compliance evidence clause 8.2 at 4 relationships. A direct
> dependency check would not have found it. 3 findings are OBSERVED [...] The
> remaining 7 are DERIVED: computed by chaining relationships, so no single
> record states them. 3 findings are NOT supported by resolvable evidence
> [...] These must not be acted on until the gap is closed. Unresolved
> references: src_ns_adr_014_current_status. [...] **Limitations:** a
> dependency path proves exposure to the change, not operational failure. No
> severity was assigned, no replacement owner was inferred, and nothing here
> has been executed. Any action requires a human decision.

Until recently this planner spent all eight steps interrogating the graph and
then stopped with no answer at all. It now reserves a step to conclude.

## Spending safeguards

| Control | Value | Where enforced |
| --- | --- | --- |
| Kill switch | `NF_AGENT_ENABLED`, default **off** | Before any planner runs |
| Model switch | `NF_AGENT_LLM`, default **off** | Separate from key presence |
| Global tokens | 150,000 / 24h | Atomic FalkorDB ledger |
| Global requests | 160 / 24h | Atomic FalkorDB ledger |
| Per visitor | 3 investigations / hour | Atomic FalkorDB counter, salted IP hash |
| Output cap | 400 tokens per call | Request body |
| Retries | **None** | No retry loop exists |

Both counters live in FalkorDB and are incremented inside a single Cypher
statement. A process-local counter would reset on every serverless cold start,
which is to say no limit at all. Proven with 10 concurrent callers against a
limit of 3: exactly 3 allowed.

When any limit is reached the model path stops and the visitor still receives
the deterministic answer, not an error.

## The 15 to 20 second film sequence

For Codex to cut into the existing film. One continuous screen recording is
better than cuts; the timings are cues, not hard edits.

| Time | On screen | Caption |
| --- | --- | --- |
| 0:00 to 0:03 | Northstar investigation loaded, nothing selected. Headline counts visible | "10 entities exposed. 12 dependency paths. One query." |
| 0:03 to 0:06 | Click **Re-run as a model-planned investigation** | "The same question, handed to a model." |
| 0:06 to 0:12 | The model-planned block fills in: `list_entities`, `analyse_impact` at depth 8, then `get_evidence` on the unsupported finding | "The model picks the tools. It cannot write, and it cannot approve." |
| 0:12 to 0:16 | Scroll to the final text naming the three unsupported findings, and the token count | "It went looking for the evidence gap. 4 requests, 3,985 tokens, half a thousandth of a dollar." |
| 0:16 to 0:20 | Trace the Meridian chain on the canvas, four hops lighting up | "Four relationships from an outage to a customer contract." |

**Do not** show the terminal, `.env.local`, the Vercel dashboard, or any
unmasked hostname.

If only one shot survives the edit, use 0:06 to 0:12. A model choosing a
traversal depth of 8 on its own, against tools that physically cannot write,
is the Track 1 claim in a single frame.
