/**
 * Sector-agnostic core model for the NexusForge reasoning engine.
 *
 * Nothing in this file knows about schools, teachers, or classes. Domain packs
 * supply the `entityType` vocabulary; the engine only understands entities,
 * dependency edges, evidence, and claim classification.
 */

/**
 * How confident the system is allowed to be about a statement.
 *
 * OBSERVED  - directly represented in the graph and backed by a source record.
 * DERIVED   - computed from observed facts by a named, versioned rule.
 * ASSESSED  - judgment or interpretation. Reserved for later stages; any
 *             AI-authored assessment must carry this label.
 */
export type ClaimClass = "OBSERVED" | "DERIVED" | "ASSESSED";

/** Identifier of the deterministic rule that produced a DERIVED claim. */
export type RuleId = string;

export interface EvidenceRef {
  /** Stable id of the Source node in FalkorDB. */
  sourceId: string;
  /** Human-readable citation, e.g. a document name and locator. */
  reference: string;
  /** Verbatim excerpt stored on the Source node. */
  excerpt: string;
  /** Domain-pack label, e.g. "resignation_letter". Never interpreted by the engine. */
  sourceType: string;
}

/** One node along a dependency path, in dependent -> dependency order. */
export interface PathNode {
  id: string;
  entityType: string;
  name: string;
  /**
   * True when the node reifies a relationship rather than representing a
   * standalone organizational thing (e.g. an assignment linking a person to a
   * class). Intermediary nodes count toward `edgeHops` but not `entityHops`.
   */
  intermediary: boolean;
}

/** A single concrete route from an affected entity to the changed entity. */
export interface DependencyPath {
  /** Ordered nodes: [affected, ...intermediate, root]. */
  nodes: PathNode[];
  /**
   * Stable ids of the DEPENDS_ON relationships traversed, in path order.
   * `relationshipIds.length === edgeHops`. These make a persisted finding
   * re-checkable against the exact edges it was derived from.
   */
  relationshipIds: string[];
  /** Number of graph relationships traversed. */
  edgeHops: number;
  /**
   * Number of meaningful organizational dependency transitions. Equals
   * `edgeHops` minus the hops consumed by intermediary nodes. Deliberately NOT
   * assumed equal to edgeHops (architecture rule 2.4).
   */
  entityHops: number;
  /** Evidence attached to each relationship along this route. */
  evidence: EvidenceRef[];
}

/**
 * One distinct entity exposed to the change, with every route by which the
 * graph reaches it.
 *
 * "Exposed" is the deliberate word. A dependency path proves connectivity and
 * directionality; it does NOT by itself prove operational failure. Severity and
 * failure judgments are out of scope for Stage 1 and are not fabricated here.
 */
export interface ImpactedEntity {
  entityId: string;
  entityType: string;
  name: string;
  /** Shortest route by edge hops. Ties broken by the stable path signature. */
  shortestPath: DependencyPath;
  /** All distinct routes found within the traversal bound, including the shortest. */
  allPaths: DependencyPath[];
  /** Distinct evidence across all routes, deduplicated by sourceId. */
  evidence: EvidenceRef[];
  /**
   * OBSERVED: the dependency chain and its evidence are present in the graph.
   * The exposure itself is a graph fact, not an interpretation.
   */
  claim: ClaimClass;
  /** Rule that produced this record. */
  ruleId: RuleId;
}

export interface ImpactAnalysis {
  /** Entity whose change is being analysed. */
  rootEntityId: string;
  rootEntityType: string;
  rootName: string;
  /** Traversal depth bound actually applied. */
  maxDepth: number;
  /** Distinct affected entities. Each entity appears exactly once. */
  impacted: ImpactedEntity[];
  /** Count of distinct entities. Never a path count. */
  distinctImpactedCount: number;
  /** Total routes found across all entities. Always >= distinctImpactedCount. */
  totalPathCount: number;
  /** Entities reached by a path carrying no evidence on one or more of its edges. */
  unevidencedEntityIds: string[];
  ruleId: RuleId;
  graphName: string;
}
