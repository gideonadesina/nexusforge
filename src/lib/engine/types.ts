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

/**
 * Whether the evidence backing a statement actually resolves.
 *
 * COMPLETE - every traversed edge names a source, and every source exists.
 * PARTIAL  - at least one edge resolved, at least one did not.
 * MISSING  - no edge on this route resolved to a real source record.
 *
 * This is reported separately from the claim class because the two answer
 * different questions: the claim says *how* a statement was reached, the
 * evidence status says *whether it is supported*.
 */
export type EvidenceStatus = "COMPLETE" | "PARTIAL" | "MISSING";

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
  /** Whether every edge on this route is backed by a resolvable source. */
  evidenceStatus: EvidenceStatus;
  /**
   * Source ids named by an edge on this route that do NOT exist as Source
   * nodes, plus a marker for edges naming no source at all. Reported so the
   * gap is explicit; never silently filled in.
   */
  unresolvedSourceIds: string[];
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
   * How this exposure was established.
   *
   * OBSERVED - the entity depends on the changed entity through a SINGLE
   *            relationship that is directly backed by a resolvable source.
   *            This is a fact read straight out of the graph.
   * DERIVED  - the exposure was computed by following a chain of two or more
   *            relationships. Transitive reachability is a rule-based
   *            conclusion, not something any single record states.
   *
   * Stage 2A incorrectly labelled every impacted entity OBSERVED, including
   * three-hop conclusions and entities with unresolved evidence.
   */
  claim: ClaimClass;
  /** Best evidence status across all routes to this entity. */
  evidenceStatus: EvidenceStatus;
  /**
   * False when the best available route has unresolved evidence. An
   * unsupported conclusion must never be presented as verified.
   */
  supported: boolean;
  /** Distinct unresolved source references across all routes. */
  unresolvedSourceIds: string[];
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
