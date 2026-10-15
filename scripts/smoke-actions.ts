/** Fast smoke check of the Stage 2B action workflow. Self-cleaning. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { seedEducationGraph } = await import("../src/lib/graph/seed");
const { runAndPersistAnalysis } = await import("../src/lib/runs/analyse-and-persist");
const { listFindings } = await import("../src/lib/runs/persist");
const {
  proposeActions, approveProposal, rejectProposal, listProposals,
  listAuditEvents, getProposal, InvalidTransitionError,
} = await import("../src/lib/actions/actions");
const { RunAuthorizationError } = await import("../src/lib/runs/authz");
const { closeDb, dropGraph } = await import("../src/lib/falkor/client");
const { SCENARIO_ROOT_ENTITY_ID } = await import("../src/domain/education/seed-data");

const graph = `nf_test_smokeact_${Date.now()}`;
let fails = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
  if (!ok) fails += 1;
};

try {
  await seedEducationGraph(graph);
  const r = await runAndPersistAnalysis(graph, SCENARIO_ROOT_ENTITY_ID);
  const creds = { analysisRunId: r.run.analysisRunId, ownerToken: r.run.ownerToken };

  // --- Priority 1: claim classification -------------------------------
  const findings = await listFindings(graph, r.run.analysisRunId);
  const observed = findings.filter((f) => f.claim === "OBSERVED");
  const derived = findings.filter((f) => f.claim === "DERIVED");
  console.log(`\nclaims: OBSERVED=${observed.length} DERIVED=${derived.length}`);
  for (const f of findings) {
    console.log(`  ${f.claim.padEnd(8)} hops=${f.edgeHops} ev=${f.evidenceStatus} ${f.entityId}`);
  }
  check("not everything is OBSERVED", derived.length > 0);
  check("direct 1-hop deps are OBSERVED", observed.every((f) => f.edgeHops === 1));
  check("multi-hop deps are DERIVED", derived.every((f) => f.edgeHops > 1 || f.evidenceStatus !== "COMPLETE"));
  check("all fully-evidenced seed findings supported", findings.every((f) => f.supported === true));

  // --- Priority 2: proposals ------------------------------------------
  const p = await proposeActions(graph, creds, r.analysis);
  console.log(`\nproposals written: ${p.proposalsWritten}`);
  const proposals = await listProposals(graph, r.run.analysisRunId);
  for (const pr of proposals) {
    console.log(`  ${pr.state.padEnd(9)} ${pr.actionType.padEnd(22)} ${pr.targetEntityId}`);
  }
  check("proposals generated from direct dependencies", proposals.length > 0);
  check("all start PROPOSED", proposals.every((x) => x.state === "PROPOSED"));
  check("all claim ASSESSED", proposals.every((x) => x.claim === "ASSESSED"));
  check("no evidence-gap proposals on a clean seed",
    proposals.every((x) => x.ruleId !== "rule.action.resolve-evidence-gap@1"));

  // idempotent
  await proposeActions(graph, creds, r.analysis);
  check("re-proposing does not duplicate",
    (await listProposals(graph, r.run.analysisRunId)).length === proposals.length);

  // --- Priority 3: transitions + audit --------------------------------
  const target = proposals[0]!;
  const appr = await approveProposal(graph, creds, target.proposalId, "demo approval");
  check("approve returns executed=false", appr.executed === false);
  check("state is APPROVED", (await getProposal(graph, target.proposalId))!.state === "APPROVED");

  let audits = await listAuditEvents(graph, r.run.analysisRunId);
  check("one audit event created", audits.length === 1, String(audits.length));
  check("audit records fromState PROPOSED", audits[0]?.fromState === "PROPOSED");
  check("audit actor is DEMO_RUN_OWNER", audits[0]?.actor === "DEMO_RUN_OWNER");

  // repeat approve -> invalid transition, no duplicate audit
  let invalid = false;
  try { await approveProposal(graph, creds, target.proposalId); }
  catch (e) { invalid = e instanceof InvalidTransitionError; }
  check("repeat approve rejected as invalid transition", invalid);
  audits = await listAuditEvents(graph, r.run.analysisRunId);
  check("no duplicate audit event", audits.length === 1, String(audits.length));

  // reject a different one
  const second = proposals[1]!;
  await rejectProposal(graph, creds, second.proposalId, "not needed");
  check("reject works", (await getProposal(graph, second.proposalId))!.state === "REJECTED");
  check("two audit events now", (await listAuditEvents(graph, r.run.analysisRunId)).length === 2);

  // wrong token
  let denied = false;
  try { await approveProposal(graph, { analysisRunId: r.run.analysisRunId, ownerToken: "nope" }, proposals[2]!.proposalId); }
  catch (e) { denied = e instanceof RunAuthorizationError; }
  check("wrong token denied", denied);
  check("still two audit events", (await listAuditEvents(graph, r.run.analysisRunId)).length === 2);
  check("third proposal still PROPOSED", (await getProposal(graph, proposals[2]!.proposalId))!.state === "PROPOSED");
} catch (err) {
  fails += 1;
  console.error(`SMOKE ERROR: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await dropGraph(graph);
  await closeDb();
}

console.log(fails === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
