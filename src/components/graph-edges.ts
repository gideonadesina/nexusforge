import type { ImpactedEntity, DependencyPath } from "./types";

/**
 * Edge derivation.
 *
 * Every rendered edge comes from a dependency path the reasoning engine
 * actually returned. For a path [a, b, c] with relationshipIds [r1, r2], the
 * engine is asserting two real DEPENDS_ON relationships: a-[r1]->b and
 * b-[r2]->c. Nothing is inferred beyond that, and no edge is ever drawn to
 * make the picture look connected.
 *
 * Direction: edges are stored dependent -> dependency. Impact propagates the
 * OTHER way, from the changed entity outward to the things that depend on it.
 * The canvas draws the stored direction (it is the verifiable fact) and the
 * legend states the propagation direction explicitly.
 */

export interface GraphEdge {
  /** Real DEPENDS_ON relationship id from FalkorDB. */
  relationshipId: string;
  /** The entity that depends. */
  fromId: string;
  /** The entity it depends on. */
  toId: string;
}

/** Collect the distinct relationships across every returned path. */
export function deriveEdges(impacted: ImpactedEntity[]): GraphEdge[] {
  const byRelId = new Map<string, GraphEdge>();

  for (const entity of impacted) {
    for (const path of entity.allPaths) {
      collectFromPath(path, byRelId);
    }
  }

  return [...byRelId.values()].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
}

function collectFromPath(path: DependencyPath, out: Map<string, GraphEdge>): void {
  for (let i = 0; i < path.nodes.length - 1; i += 1) {
    const from = path.nodes[i];
    const to = path.nodes[i + 1];
    const relationshipId = path.relationshipIds[i];

    // Without a real relationship id we cannot claim the edge is verified, so
    // we do not draw it. This is deliberately silent rather than synthesised.
    if (!from || !to || !relationshipId) continue;
    if (relationshipId.startsWith("unidentified_edge_")) continue;

    out.set(relationshipId, { relationshipId, fromId: from.id, toId: to.id });
  }
}

/** The nodes and relationships making up one specific route. */
export interface TracedRoute {
  nodeIds: Set<string>;
  relationshipIds: Set<string>;
  /** Ordered node ids, nearest-to-change last. */
  ordered: string[];
}

export function traceRoute(path: DependencyPath | undefined): TracedRoute | null {
  if (!path) return null;
  const nodeIds = new Set(path.nodes.map((n) => n.id));
  const relationshipIds = new Set(
    path.relationshipIds.filter((r) => !r.startsWith("unidentified_edge_")),
  );
  return { nodeIds, relationshipIds, ordered: path.nodes.map((n) => n.id) };
}
