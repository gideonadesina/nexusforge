import type { DomainPack } from "../graph/domain-pack";
import { EDUCATION_PACK } from "../graph/seed";
import {
  DOMAIN as NS_DOMAIN,
  SEED_VERSION as NS_SEED_VERSION,
  SOURCES as NS_SOURCES,
  ENTITIES as NS_ENTITIES,
  DEPENDENCIES as NS_DEPENDENCIES,
  SCENARIO_ROOT_ENTITY_ID as NS_ROOT,
  DECOY_ENTITY_IDS as NS_DECOYS,
  DANGLING_SOURCE_IDS as NS_DANGLING,
} from "../../domain/northstar/seed-data";
import { resolveOrg, type OrganizationDescriptor } from "./registry";

/**
 * Maps an organization to its domain pack.
 *
 * Kept separate from the registry so the registry stays a pure allowlist with
 * no data imports, and so adding a sector is one entry in one table.
 */

export const NORTHSTAR_PACK: DomainPack = {
  domain: NS_DOMAIN,
  seedVersion: NS_SEED_VERSION,
  sources: NS_SOURCES,
  entities: NS_ENTITIES,
  dependencies: NS_DEPENDENCIES,
  scenarioRootId: NS_ROOT,
  decoyEntityIds: NS_DECOYS,
  danglingSourceIds: NS_DANGLING,
};

const PACKS: Record<string, DomainPack> = {
  northstar: NORTHSTAR_PACK,
  education: EDUCATION_PACK,
};

export interface OrgContext {
  org: OrganizationDescriptor;
  pack: DomainPack;
  /** Server-side only. Never returned to the browser. */
  graphName: string;
}

/**
 * Resolve an organization id to everything the server needs.
 *
 * This is the single entry point every route uses, so a route physically
 * cannot operate on a graph the allowlist did not authorise.
 */
export function orgContext(id: unknown): OrgContext {
  const org = resolveOrg(id);
  const pack = PACKS[org.id];
  if (!pack) {
    throw new Error(`Registry misconfiguration: no domain pack for organization ${org.id}.`);
  }
  return { org, pack, graphName: org.graphName };
}
