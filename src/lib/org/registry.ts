import { z } from "zod";
import { GRAPH_PREFIX } from "../env";

/**
 * Organization registry — the ONLY place a graph name can come from.
 *
 * The browser sends an organization id. It never sends, and can never
 * influence, a FalkorDB graph name. An unknown id fails closed rather than
 * falling back to a default, because a silent fallback would quietly serve
 * one organization's data under another's name.
 *
 * Isolation strategy: one graph per organization. Cross-organization leakage
 * is then prevented by the database boundary itself rather than by a WHERE
 * clause somebody might forget. A run id from organization A simply does not
 * exist in organization B's graph.
 *
 * This is DEMONSTRATION isolation, not enterprise multitenancy: there is no
 * per-user identity, and an operator with instance credentials can read every
 * graph.
 */

export interface OrganizationDescriptor {
  id: string;
  label: string;
  sector: string;
  /** Resolved server-side only. */
  graphName: string;
  /** Entity the flagship investigation starts from. */
  scenarioRootId: string;
  synthetic: true;
  notice: string;
  headline: string;
}

export const ORGANIZATIONS: Record<string, OrganizationDescriptor> = {
  northstar: {
    id: "northstar",
    label: "Northstar Labs",
    sector: "Technology operations",
    graphName: "nf_demo_northstar",
    scenarioRootId: "ns_svc_inference_gateway",
    synthetic: true,
    notice:
      "Synthetic demonstration organization. No real company, person, system or customer is represented.",
    headline:
      "If the AI inference gateway becomes unavailable, what is exposed and what blocks recovery?",
  },
  education: {
    id: "education",
    label: "Northgate Secondary School",
    sector: "Education",
    graphName: "nf_demo_education",
    scenarioRootId: "ent_person_okonkwo",
    synthetic: true,
    notice:
      "Synthetic demonstration organization. No real school, person, document or examination is represented.",
    headline: "If the only senior physics teacher resigns, what is exposed before the mock exams?",
  },
};

/** Default organization for the public demonstration. */
export const DEFAULT_ORG_ID = "northstar";

/** Strict: only ids present in the registry are accepted. */
export const OrgIdSchema = z.enum(
  Object.keys(ORGANIZATIONS) as [string, ...string[]],
);

export class UnknownOrganizationError extends Error {
  constructor(received: unknown) {
    super(
      `Unknown organization identifier (${typeof received}). ` +
        `Allowed: ${Object.keys(ORGANIZATIONS).join(", ")}.`,
    );
    this.name = "UnknownOrganizationError";
  }
}

/**
 * Resolve an organization id to its descriptor.
 *
 * Fails closed. `undefined` means "not supplied" and yields the default;
 * anything else that is not in the allowlist is an error, never a fallback.
 */
export function resolveOrg(id: unknown): OrganizationDescriptor {
  const raw = id === undefined || id === null || id === "" ? DEFAULT_ORG_ID : id;
  const parsed = OrgIdSchema.safeParse(raw);
  if (!parsed.success) throw new UnknownOrganizationError(id);

  const org = ORGANIZATIONS[parsed.data];
  if (!org) throw new UnknownOrganizationError(id);

  // Belt and braces: the ownership guard in the client also enforces this,
  // but a registry entry that slipped the prefix would be a silent hazard.
  if (!org.graphName.startsWith(GRAPH_PREFIX)) {
    throw new Error(`Registry misconfiguration: ${org.id} graph lacks the ${GRAPH_PREFIX} prefix.`);
  }
  return org;
}

/** Public-safe view. Never exposes the graph name to the browser. */
export interface PublicOrganization {
  id: string;
  label: string;
  sector: string;
  synthetic: true;
  notice: string;
  headline: string;
}

export function publicView(org: OrganizationDescriptor): PublicOrganization {
  return {
    id: org.id,
    label: org.label,
    sector: org.sector,
    synthetic: org.synthetic,
    notice: org.notice,
    headline: org.headline,
  };
}

export function listPublicOrganizations(): PublicOrganization[] {
  return Object.values(ORGANIZATIONS).map(publicView);
}
