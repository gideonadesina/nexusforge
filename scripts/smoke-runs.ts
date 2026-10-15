/** Fast smoke check of the Stage 2A run persistence Cypher. Self-cleaning. */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { seedEducationGraph } = await import("../src/lib/graph/seed");
const { runAndPersistAnalysis, retryPersistAnalysis } = await import(
  "../src/lib/runs/analyse-and-persist"
);
const { getRun, listFindings, adminDeleteRun } = await import("../src/lib/runs/persist");
const { withRunAuthorization, RunAuthorizationError } = await import("../src/lib/runs/authz");
const { closeDb, dropGraph } = await import("../src/lib/falkor/client");
const { SCENARIO_ROOT_ENTITY_ID } = await import("../src/domain/education/seed-data");

const graph = `nf_test_smoke_${Date.now()}`;
let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails += 1;
};

try {
  await seedEducationGraph(graph);
  console.log(`seeded ${graph}`);

  const r = await runAndPersistAnalysis(graph, SCENARIO_ROOT_ENTITY_ID);
  console.log(`run ${r.run.analysisRunId} findingsWritten=${r.findingsWritten} attempts=${r.persistAttempts}`);
  check("findings written equals distinct impacted", r.findingsWritten === r.analysis.distinctImpactedCount,
    `${r.findingsWritten} vs ${r.analysis.distinctImpactedCount}`);

  const run = await getRun(graph, r.run.analysisRunId);
  check("run readable", run !== null);
  check("run status COMPLETED", run?.status === "COMPLETED", String(run?.status));
  check("ownerTokenHash NOT returned", !("ownerTokenHash" in (run ?? {})));
  check("persistAttempts = 1", run?.persistAttempts === 1, String(run?.persistAttempts));

  const findings = await listFindings(graph, r.run.analysisRunId);
  check("findings listed", findings.length === r.analysis.distinctImpactedCount, String(findings.length));
  const exam = findings.find((f) => f.entityId === "ent_exam_waec_mock_physics");
  check("exam finding present", !!exam);
  check("relationship ids stored", (exam?.shortestPathRelationshipIds?.length ?? 0) > 0,
    JSON.stringify(exam?.shortestPathRelationshipIds));
  check("path signatures stored", (exam?.allPathSignatures?.length ?? 0) === 3,
    String(exam?.allPathSignatures?.length));
  check("evidence ids stored", (exam?.evidenceSourceIds?.length ?? 0) > 0);

  // retry idempotency
  const retry = await retryPersistAnalysis(
    graph,
    { analysisRunId: r.run.analysisRunId, ownerToken: r.run.ownerToken },
    SCENARIO_ROOT_ENTITY_ID,
  );
  const after = await listFindings(graph, r.run.analysisRunId);
  check("retry does not duplicate findings", after.length === findings.length,
    `${findings.length} -> ${after.length}`);
  check("persistAttempts incremented to 2", retry.persistAttempts === 2, String(retry.persistAttempts));

  // authz: wrong token
  let rejected = false;
  try {
    await withRunAuthorization(graph, { analysisRunId: r.run.analysisRunId, ownerToken: "wrong" },
      `SET run.status = 'HACKED'`, `RETURN run.analysisRunId AS id`);
  } catch (e) { rejected = e instanceof RunAuthorizationError; }
  check("wrong token rejected", rejected);
  const afterBad = await getRun(graph, r.run.analysisRunId);
  check("status unchanged after rejected mutation", afterBad?.status === "COMPLETED", String(afterBad?.status));

  // admin delete
  const del = await adminDeleteRun(graph, r.run.analysisRunId, {
    iUnderstandThisBypassesOwnership: true, reason: "smoke test cleanup",
  });
  check("admin delete removed findings", del.deletedFindings === findings.length, String(del.deletedFindings));
  check("run gone", (await getRun(graph, r.run.analysisRunId)) === null);
} catch (err) {
  fails += 1;
  console.error(`SMOKE ERROR: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await dropGraph(graph);
  await closeDb();
}

console.log(fails === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
