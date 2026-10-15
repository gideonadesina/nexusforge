"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ImpactedEntity } from "./types";
import { deriveEdges, traceRoute, type GraphEdge } from "./graph-edges";

/**
 * Hop-column canvas with real directed edges.
 *
 * One column per hop, left to right, so distance from the change is spatial
 * rather than a number to read. Every edge corresponds to a DEPENDS_ON
 * relationship the engine actually traversed, keyed by its real relationship
 * id — nothing is drawn for visual effect.
 *
 * Edges are measured from the live DOM and rendered into an SVG layer that
 * lives inside the same scrolling content, so they stay glued to their nodes
 * through scroll, resize and reflow without any scroll listeners.
 */

export interface CanvasProps {
  rootName: string;
  rootEntityId: string;
  rootEntityType: string;
  impacted: ImpactedEntity[];
  selectedId: string | null;
  /** Which of the selected entity's routes is being traced. */
  activePathIndex: number;
  onSelect: (entityId: string) => void;
  /** Reveal animation progress: how many hop columns are visible. */
  revealedHops: number;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

export function Canvas({
  rootName,
  rootEntityId,
  rootEntityType,
  impacted,
  selectedId,
  activePathIndex,
  onSelect,
  revealedHops,
}: CanvasProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  const columns = useMemo(() => {
    const byHop = new Map<number, ImpactedEntity[]>();
    for (const e of impacted) {
      const hop = e.shortestPath.edgeHops;
      const list = byHop.get(hop) ?? [];
      list.push(e);
      byHop.set(hop, list);
    }
    return [...byHop.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hop, entities]) => ({
        hop,
        entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [impacted]);

  const edges = useMemo(() => deriveEdges(impacted), [impacted]);

  const selected = impacted.find((e) => e.entityId === selectedId) ?? null;
  const traced = useMemo(
    () => traceRoute(selected?.allPaths[activePathIndex] ?? selected?.shortestPath),
    [selected, activePathIndex],
  );

  const registerNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  /** Measure every node relative to the scrolling content box. */
  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const base = content.getBoundingClientRect();
    const next = new Map<string, Box>();
    for (const [id, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      next.set(id, {
        left: r.left - base.left,
        right: r.right - base.left,
        top: r.top - base.top,
        bottom: r.bottom - base.top,
        cx: r.left - base.left + r.width / 2,
        cy: r.top - base.top + r.height / 2,
      });
    }
    setBoxes(next);
    setCanvasSize({ w: content.scrollWidth, h: content.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, impacted, revealedHops, columns]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(content);
    for (const el of nodeRefs.current.values()) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, impacted]);

  const visibleHop = (hop: number) => hop <= revealedHops;

  return (
    <div className="nf-scroll h-full overflow-auto p-6">
      <div ref={contentRef} className="relative inline-block min-w-full">
        {/* Edge layer. Sits under the cards and scrolls with them. */}
        <EdgeLayer
          edges={edges}
          boxes={boxes}
          width={canvasSize.w}
          height={canvasSize.h}
          tracedRelIds={traced?.relationshipIds ?? null}
        />

        <div className="relative flex min-w-max items-start gap-16">
          <section aria-label="The change" className="w-56 shrink-0">
            <ColumnHeader hop={0} label="changed" count={1} />
            <article
              ref={(el) => registerNode(rootEntityId, el)}
              className={`nf-anim relative border-2 border-[var(--color-accent)] bg-[var(--color-surface-2)] p-3 ${
                traced && !traced.nodeIds.has(rootEntityId) ? "nf-dimmed" : ""
              }`}
            >
              <div className="nf-graph-value text-[var(--color-accent)]">{rootEntityType}</div>
              <div className="mt-1 text-sm font-medium leading-snug">{rootName}</div>
              <div className="nf-graph-value mt-2 break-all text-[var(--color-ink-faint)]">
                {rootEntityId}
              </div>
            </article>
          </section>

          {columns.map((col) => (
            <section
              key={col.hop}
              aria-label={`Entities ${col.hop} hop${col.hop === 1 ? "" : "s"} from the change`}
              className={`nf-anim w-56 shrink-0 ${
                visibleHop(col.hop) ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <ColumnHeader
                hop={col.hop}
                label={col.hop === 1 ? "direct" : "indirect"}
                count={col.entities.length}
              />
              <ul className="space-y-3">
                {col.entities.map((e) => (
                  <li key={e.entityId}>
                    <EntityNode
                      entity={e}
                      selected={e.entityId === selectedId}
                      dimmed={traced !== null && !traced.nodeIds.has(e.entityId)}
                      onSelect={onSelect}
                      registerNode={registerNode}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {impacted.length === 0 && (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
          No dependent entities were found within the traversal bound.
        </p>
      )}

      <Legend />
    </div>
  );
}

/**
 * SVG edge layer.
 *
 * Arrowheads point along the STORED direction (dependent -> dependency),
 * because that is the relationship the database actually holds. Impact runs
 * the opposite way; the legend says so rather than the arrows lying about it.
 */
function EdgeLayer({
  edges,
  boxes,
  width,
  height,
  tracedRelIds,
}: {
  edges: GraphEdge[];
  boxes: Map<string, Box>;
  width: number;
  height: number;
  tracedRelIds: Set<string> | null;
}) {
  if (width === 0 || height === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-0"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="nf-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-line-strong)" />
        </marker>
        <marker
          id="nf-arrow-traced"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-accent)" />
        </marker>
      </defs>

      {edges.map((edge) => {
        const from = boxes.get(edge.fromId); // dependent, further right
        const to = boxes.get(edge.toId); // dependency, further left
        if (!from || !to) return null;

        // Leave the dependent's left face, arrive at the dependency's right face.
        const x1 = from.left;
        const y1 = from.cy;
        const x2 = to.right;
        const y2 = to.cy;
        const dx = Math.max(24, Math.abs(x1 - x2) * 0.45);
        const d = `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}`;

        const isTraced = tracedRelIds?.has(edge.relationshipId) ?? false;
        const dimmed = tracedRelIds !== null && !isTraced;

        return (
          <path
            key={edge.relationshipId}
            d={d}
            fill="none"
            stroke={isTraced ? "var(--color-accent)" : "var(--color-line-strong)"}
            strokeWidth={isTraced ? 2 : 1}
            opacity={dimmed ? 0.18 : isTraced ? 1 : 0.65}
            markerEnd={isTraced ? "url(#nf-arrow-traced)" : "url(#nf-arrow)"}
            className="nf-anim"
          />
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--color-line)] pt-3 text-[0.6875rem] text-[var(--color-ink-faint)]">
      <span className="flex items-center gap-1.5">
        <svg width="34" height="8" aria-hidden="true">
          <line x1="32" y1="4" x2="2" y2="4" stroke="var(--color-line-strong)" strokeWidth="1" />
          <path d="M 8 1 L 2 4 L 8 7 z" fill="var(--color-line-strong)" />
        </svg>
        arrow = <span className="nf-graph-value">DEPENDS_ON</span> (dependent → dependency)
      </span>
      <span>impact propagates the other way: left → right, outward from the change</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 border border-dashed border-[var(--color-sev-warn)]" />
        dashed / hollow = incomplete evidence
      </span>
    </div>
  );
}

function ColumnHeader({ hop, label, count }: { hop: number; label: string; count: number }) {
  return (
    <header className="mb-2 flex items-baseline justify-between border-b border-[var(--color-line)] pb-1.5">
      <span className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </span>
      <span className="nf-graph-value nf-num text-[var(--color-ink-faint)]">
        {hop} hop · {count}
      </span>
    </header>
  );
}

function EntityNode({
  entity,
  selected,
  dimmed,
  onSelect,
  registerNode,
}: {
  entity: ImpactedEntity;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  registerNode: (id: string, el: HTMLElement | null) => void;
}) {
  const uncertain = entity.evidenceStatus !== "COMPLETE";

  return (
    <button
      type="button"
      ref={(el) => registerNode(entity.entityId, el)}
      onClick={() => onSelect(entity.entityId)}
      aria-pressed={selected}
      className={[
        "nf-anim relative z-10 w-full border p-3 text-left",
        uncertain
          ? "border-dashed border-[var(--color-sev-warn)] bg-[var(--color-surface-1)]"
          : "border-[var(--color-line)] bg-[var(--color-surface-2)]",
        selected ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]" : "",
        dimmed ? "nf-dimmed" : "",
        "hover:border-[var(--color-line-strong)]",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="nf-graph-value text-[var(--color-ink-muted)]">
          {entity.entityType}
        </span>
        {entity.allPaths.length > 1 && (
          <span
            className="nf-graph-value nf-num text-[var(--color-ink-faint)]"
            title={`${entity.allPaths.length} independent dependency routes reach this entity`}
          >
            ×{entity.allPaths.length}
          </span>
        )}
      </div>

      <div className="mt-1 text-sm leading-snug">{entity.name}</div>

      <div className="mt-2 flex items-center gap-2 text-[0.6875rem]">
        <span className="nf-graph-value nf-num text-[var(--color-ink-faint)]">
          {entity.shortestPath.edgeHops}e / {entity.shortestPath.entityHops}n
        </span>
        {uncertain && <span className="text-[var(--color-sev-warn)]">partial evidence</span>}
      </div>
    </button>
  );
}
