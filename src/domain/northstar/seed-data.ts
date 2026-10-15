import type { SeedSource, SeedEntity, SeedDependency } from "../education/seed-data";

/**
 * Domain pack: Northstar Labs (synthetic technology-operations organization).
 *
 * ALL records are SYNTHETIC. No real company, person, system, customer or
 * contract is represented.
 *
 * This pack exists to prove the engine is not education-specific: it reuses
 * the same traversal, claim classification, evidence rules, Trace and action
 * machinery without a single engine change. Only the data differs.
 *
 * The scenario is deliberately built around four things a flat service tree
 * would not demonstrate:
 *
 *  A. A HIDDEN ASYNCHRONOUS DEPENDENCY. The inference gateway publishes to an
 *     event topic; an audit processor consumes it; the audit ledger is built
 *     from that; a customer compliance obligation is evidenced from the
 *     ledger; and an enterprise contract requires that obligation. Nothing
 *     connects the gateway to the contract directly -- the traversal has to
 *     find it through four relationships.
 *
 *  B. An OWNERSHIP GAP. The on-call assignment covering failover points at a
 *     person who has left, and the roster names no deputy. The engine reports
 *     the unresolved responsibility; it does NOT invent a replacement, because
 *     no graph data supports one.
 *
 *  C. An UNCERTAIN RECOVERY CONSTRAINT. The external failover plan cites an
 *     architecture decision whose current status cannot be resolved (the
 *     source record does not exist). That edge therefore carries MISSING
 *     evidence, so the finding is flagged as unsupported rather than being
 *     used to recommend a workaround.
 *
 *  D. DECOYS. Billing and model-registry services are plausible neighbours in
 *     an AI company but have no dependency route to the gateway. Deterministic
 *     traversal must exclude them.
 */

export const DOMAIN = "technology-operations";
export const SEED_VERSION = "northstar-v1";

export const SCENARIO_ROOT_ENTITY_ID = "ns_svc_inference_gateway";

/**
 * Referenced by a dependency edge but deliberately NOT created as a Source
 * node. This models a real and common situation: a document is cited, but its
 * current version cannot be located, so the claim resting on it is
 * unsupported. The engine must report the gap, never paper over it.
 */
export const DANGLING_SOURCE_IDS = ["src_ns_adr_014_current_status"] as const;

export const SOURCES: SeedSource[] = [
  {
    id: "src_ns_service_catalog",
    reference: "Northstar service catalogue, Q4 2026, rev 31",
    excerpt:
      "inference-gateway: shared model-serving ingress for all product traffic. Consumers: copilot-api, batch-scoring. Billing-api and model-registry operate on an independent path.",
    sourceType: "service_catalog",
  },
  {
    id: "src_ns_event_contract",
    reference: "Event contract: inference.events v2, approved 2026-07-02",
    excerpt:
      "inference-gateway publishes one envelope per completed inference to topic inference.events. Delivery is at-least-once. If the gateway stops, the topic receives no new envelopes; consumers see silence rather than an error.",
    sourceType: "event_contract",
  },
  {
    id: "src_ns_audit_design",
    reference: "Audit subsystem design note, 2026-05-19",
    excerpt:
      "audit-processor is the sole consumer of inference.events. It derives the immutable audit ledger. The ledger has no second write path; if the stream is silent, the ledger is simply incomplete for that period and the gap is not self-healing.",
    sourceType: "design_note",
  },
  {
    id: "src_ns_compliance_policy",
    reference: "Compliance evidence policy CP-07, effective 2026-01-01",
    excerpt:
      "Quarterly customer compliance evidence is generated from the immutable audit ledger and requires the audit processor to have run continuously across the reporting window. Gaps must be disclosed.",
    sourceType: "compliance_policy",
  },
  {
    id: "src_ns_meridian_msa",
    reference: "Meridian Health master services agreement, schedule 3, clause 8.2",
    excerpt:
      "Supplier shall provide quarterly compliance evidence covering all inference performed on customer data. Failure to deliver complete evidence constitutes a reportable service deficiency.",
    sourceType: "contract",
  },
  {
    id: "src_ns_runbook_failover",
    reference: "Runbook RB-212: inference gateway loss of service",
    excerpt:
      "On total gateway loss, execute the external failover plan. Note: the plan's applicability depends on architecture decision ADR-014, whose current status should be confirmed before execution.",
    sourceType: "runbook",
  },
  {
    id: "src_ns_oncall_roster",
    reference: "Platform on-call roster, Q4 2026",
    excerpt:
      "Gateway failover execution: D. Okafor (Staff SRE). Note: D. Okafor left the organization on 2026-09-30. No deputy has been recorded for this rotation.",
    sourceType: "oncall_roster",
  },
  {
    id: "src_ns_incident_postmortem",
    reference: "Postmortem INC-4471, 2026-08-14",
    excerpt:
      "A 41-minute gateway degradation produced a corresponding 41-minute hole in the audit ledger. The hole was not detected until the quarterly evidence build failed three weeks later.",
    sourceType: "postmortem",
  },
];

export const ENTITIES: SeedEntity[] = [
  // --- the change under investigation ------------------------------------
  {
    id: "ns_svc_inference_gateway",
    type: "Service",
    name: "AI Inference Gateway",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },

  // --- obvious synchronous consumers --------------------------------------
  {
    id: "ns_svc_copilot_api",
    type: "Service",
    name: "Copilot API",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },
  {
    id: "ns_svc_batch_scoring",
    type: "Service",
    name: "Batch Scoring Pipeline",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },

  // --- the hidden asynchronous chain --------------------------------------
  {
    id: "ns_topic_inference_events",
    type: "EventTopic",
    name: "inference.events (topic)",
    intermediary: false,
    sourceIds: ["src_ns_event_contract"],
  },
  {
    id: "ns_svc_audit_processor",
    type: "Service",
    name: "Audit Event Processor",
    intermediary: false,
    sourceIds: ["src_ns_audit_design"],
  },
  {
    id: "ns_store_audit_ledger",
    type: "Datastore",
    name: "Immutable Audit Ledger",
    intermediary: false,
    sourceIds: ["src_ns_audit_design", "src_ns_incident_postmortem"],
  },
  {
    id: "ns_obligation_soc2_evidence",
    type: "Obligation",
    name: "Quarterly customer compliance evidence",
    intermediary: false,
    sourceIds: ["src_ns_compliance_policy"],
  },
  {
    id: "ns_commitment_meridian",
    type: "CustomerCommitment",
    name: "Meridian Health MSA — compliance evidence clause 8.2",
    intermediary: false,
    sourceIds: ["src_ns_meridian_msa"],
  },

  // --- recovery path, ownership gap and uncertain constraint --------------
  {
    id: "ns_plan_failover_external",
    type: "FailoverPlan",
    name: "External provider failover plan",
    intermediary: false,
    sourceIds: ["src_ns_runbook_failover"],
  },
  {
    id: "ns_resp_gateway_failover",
    type: "Responsibility",
    name: "Gateway failover execution",
    intermediary: false,
    sourceIds: ["src_ns_runbook_failover"],
  },
  {
    // Intermediary: reifies person <-> responsibility, so it adds an edge hop
    // but not an organizational transition.
    id: "ns_assign_oncall_gateway",
    type: "OnCallAssignment",
    name: "On-call assignment: gateway failover",
    intermediary: true,
    sourceIds: ["src_ns_oncall_roster"],
  },
  {
    id: "ns_person_okafor",
    type: "Person",
    name: "D. Okafor (Staff SRE — departed 2026-09-30)",
    intermediary: false,
    sourceIds: ["src_ns_oncall_roster"],
  },
  {
    id: "ns_decision_adr014",
    type: "ArchitectureDecision",
    name: "ADR-014: single-provider inference",
    intermediary: false,
    sourceIds: ["src_ns_runbook_failover"],
  },

  // --- decoys: plausible neighbours with no route to the gateway ----------
  {
    id: "ns_svc_billing_api",
    type: "Service",
    name: "Billing API",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },
  {
    id: "ns_store_billing_db",
    type: "Datastore",
    name: "Billing database",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },
  {
    id: "ns_topic_billing_events",
    type: "EventTopic",
    name: "billing.events (topic)",
    intermediary: false,
    sourceIds: ["src_ns_event_contract"],
  },
  {
    id: "ns_svc_model_registry",
    type: "Service",
    name: "Model Registry",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },
  {
    id: "ns_store_artifacts",
    type: "Datastore",
    name: "Model artifact store",
    intermediary: false,
    sourceIds: ["src_ns_service_catalog"],
  },
];

export const DEPENDENCIES: SeedDependency[] = [
  // Obvious synchronous consumers.
  {
    id: "nsdep_copilot_on_gateway",
    from: "ns_svc_copilot_api",
    to: "ns_svc_inference_gateway",
    kind: "calls_synchronously",
    sourceId: "src_ns_service_catalog",
  },
  {
    id: "nsdep_batch_on_gateway",
    from: "ns_svc_batch_scoring",
    to: "ns_svc_inference_gateway",
    kind: "calls_synchronously",
    sourceId: "src_ns_service_catalog",
  },

  // (A) The hidden asynchronous chain.
  {
    id: "nsdep_topic_on_gateway",
    from: "ns_topic_inference_events",
    to: "ns_svc_inference_gateway",
    kind: "produced_by",
    sourceId: "src_ns_event_contract",
  },
  {
    id: "nsdep_auditproc_on_topic",
    from: "ns_svc_audit_processor",
    to: "ns_topic_inference_events",
    kind: "consumes",
    sourceId: "src_ns_event_contract",
  },
  {
    id: "nsdep_ledger_on_auditproc",
    from: "ns_store_audit_ledger",
    to: "ns_svc_audit_processor",
    kind: "written_by",
    sourceId: "src_ns_audit_design",
  },
  {
    id: "nsdep_obligation_on_ledger",
    from: "ns_obligation_soc2_evidence",
    to: "ns_store_audit_ledger",
    kind: "evidenced_from",
    sourceId: "src_ns_compliance_policy",
  },
  {
    // Second, shorter route to the same obligation: the policy requires the
    // processor to have run continuously, not merely that a ledger exists.
    id: "nsdep_obligation_on_auditproc",
    from: "ns_obligation_soc2_evidence",
    to: "ns_svc_audit_processor",
    kind: "requires_continuous_processing",
    sourceId: "src_ns_compliance_policy",
  },
  {
    id: "nsdep_meridian_on_obligation",
    from: "ns_commitment_meridian",
    to: "ns_obligation_soc2_evidence",
    kind: "contractually_requires",
    sourceId: "src_ns_meridian_msa",
  },

  // (C) Recovery path whose applicability cannot be verified. The cited
  // source does not exist, so this edge carries MISSING evidence.
  {
    id: "nsdep_plan_on_gateway",
    from: "ns_plan_failover_external",
    to: "ns_svc_inference_gateway",
    kind: "restores",
    sourceId: "src_ns_adr_014_current_status",
  },
  {
    id: "nsdep_plan_on_adr",
    from: "ns_plan_failover_external",
    to: "ns_decision_adr014",
    kind: "constrained_by",
    sourceId: "src_ns_runbook_failover",
  },
  {
    id: "nsdep_resp_on_plan",
    from: "ns_resp_gateway_failover",
    to: "ns_plan_failover_external",
    kind: "executes",
    sourceId: "src_ns_runbook_failover",
  },

  // (B) Ownership gap.
  {
    id: "nsdep_oncall_on_resp",
    from: "ns_assign_oncall_gateway",
    to: "ns_resp_gateway_failover",
    kind: "covers",
    sourceId: "src_ns_oncall_roster",
  },
  {
    id: "nsdep_oncall_on_person",
    from: "ns_assign_oncall_gateway",
    to: "ns_person_okafor",
    kind: "assigned_to",
    sourceId: "src_ns_oncall_roster",
  },

  // (D) Decoys — plausible, but no route to the gateway.
  {
    id: "nsdep_billing_on_db",
    from: "ns_svc_billing_api",
    to: "ns_store_billing_db",
    kind: "reads_writes",
    sourceId: "src_ns_service_catalog",
  },
  {
    id: "nsdep_billingtopic_on_billing",
    from: "ns_topic_billing_events",
    to: "ns_svc_billing_api",
    kind: "produced_by",
    sourceId: "src_ns_event_contract",
  },
  {
    id: "nsdep_registry_on_artifacts",
    from: "ns_svc_model_registry",
    to: "ns_store_artifacts",
    kind: "reads_writes",
    sourceId: "src_ns_service_catalog",
  },
];

/** Must never appear in an impact analysis rooted at the gateway. */
export const DECOY_ENTITY_IDS = [
  "ns_svc_billing_api",
  "ns_store_billing_db",
  "ns_topic_billing_events",
  "ns_svc_model_registry",
  "ns_store_artifacts",
] as const;

/**
 * The finding that makes the scenario worth demonstrating: an enterprise
 * contract clause is exposed by an inference service outage, through an
 * asynchronous event topic nobody would check first.
 */
export const SURPRISING_FINDING_ID = "ns_commitment_meridian";
