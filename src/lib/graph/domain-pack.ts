import type {
  SeedSource,
  SeedEntity,
  SeedDependency,
} from "../../domain/education/seed-data";

/**
 * A domain pack: everything sector-specific, in one object.
 *
 * This is the dependency inversion flagged in the Stage 2A coupling audit.
 * `seed.ts` previously imported the education pack directly, which blocked a
 * second sector. It now takes a pack as an argument, so the reasoning engine,
 * queries, evidence rules and seeding logic are shared unchanged across
 * sectors — only the data differs.
 */
export interface DomainPack {
  /** Stable domain key stored on every entity, e.g. "education". */
  domain: string;
  /** Versioned so a graph can be checked against the pack that built it. */
  seedVersion: string;
  sources: SeedSource[];
  entities: SeedEntity[];
  dependencies: SeedDependency[];
  /** Entity the flagship investigation starts from. */
  scenarioRootId: string;
  /** Entities that must never appear in an impact result for the scenario. */
  decoyEntityIds: readonly string[];
  /**
   * Source ids that dependency edges may cite WITHOUT a Source node existing.
   *
   * Models a real situation: a document is referenced but cannot be located,
   * so any claim resting on it is unsupported. Declaring them here keeps seed
   * validation strict (a typo is still caught) while allowing a deliberate,
   * documented evidence gap.
   */
  danglingSourceIds?: readonly string[];
}

export type { SeedSource, SeedEntity, SeedDependency };
