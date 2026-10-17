# Remaining screenshot capture

Two of the four shots are captured and in this folder. Two still need you,
because the Chrome extension became unreliable partway through the session
(tab ids churning, extension access intermittently blocked).

Both missing shots take about two minutes each.

## Captured

| File | Shot | State at capture |
| --- | --- | --- |
| `01-investigation-overview.jpg` | Completed Northstar investigation | 10 entities, 12 paths, **35 ms**, hop columns and directed edges visible, legend pinned |
| `03-inspector-meridian-chain.jpg` | Inspector on the Meridian finding | DERIVED / complete, "derived by following 4 dependency relationships", all four real relationship ids listed |

`03` is the strongest asset in the set. It shows the four hop chain with
`nsdep_meridian_on_obligation`, `nsdep_obligation_on_auditproc`,
`nsdep_auditproc_on_topic` and `nsdep_topic_on_gateway` as real, readable ids.

## Still needed

### 02-trace-canvas.jpg

I saw this render correctly; only the save step failed.

1. Open <https://nexusforge-ten.vercel.app>, click **Run analysis**
2. In the left findings list, under "Indirectly affected", click
   **Meridian Health MSA, compliance evidence clause 8.2**
3. Click **Close** on the Inspector. The trace stays active, which is the point
4. Scroll the canvas right so hops 2, 3 and 4 are in frame
5. Capture the canvas area only, not the whole window

What must be in frame: the trace bar reading
`Tracing Meridian Health MSA, compliance evidence clause 8.2  route 1 of 2`,
the teal highlighted path, and at least two dimmed cards beside it. The
contrast between highlighted and dimmed is the entire message.

### 04-proposals-approval.jpg

1. With the analysis still on screen, scroll the left column to
   **Proposed actions**
2. Capture from the "A decision here is recorded, not executed" line down
   through at least one proposal card with its **Approve decision** and
   **Reject** buttons

What must be in frame: the "not executed" sentence and the buttons together.
That pairing is the claim the article makes about approval semantics.

Do not click Approve. A decision writes a permanent audit event to the demo
graph, and the article does not need a decided proposal to make its point.

### Optional, only if quick

- `05-query-receipt.jpg`: Inspector scrolled to "Query receipt", showing the
  Cypher template and bound parameters
- `06-evidence-gap.jpg`: click **External provider failover plan** (the dashed,
  hollow card). Inspector shows `MISSING` evidence, "unsupported, must not be
  acted on", and the unresolved reference `src_ns_adr_014_current_status`.
  This one is worth the effort: it is the honesty claim made visible

## Capture settings

- Viewport around 1280 px wide. The display here capped height at 533 px,
  which is why the saved shots are wide and short. Taller is better if your
  display allows it
- Dark theme only, the app has no light mode
- Crop tightly, full window shots read as clutter at article width
- Do not capture the terminal, `.env.local`, the Vercel dashboard, or any view
  showing a real hostname
