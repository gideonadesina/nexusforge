"use client";

import { useMemo } from "react";
import type { ImpactedEntity } from "./types";

/**
 * Hop-column canvas.
 *
 * One column per hop, left to right, so distance from the change is a spatial
 * fact rather than a number the user has to read. The changed entity is
 * column 0.
 *
 * Uncertainty is carried by FORM: an entity with incomplete evidence gets a
 * dashed border and a hollow fill, so the signal survives greyscale.
 */

export interface CanvasProps {
  rootName: string;
  rootEntityId: string;
  rootEntityType: string;
  impacted: ImpactedEntity[];
  /** Entity currently being traced, if any. */
  selectedId: string | null;
  onSelect: (entityId: string) => void;
}

interface Column {
  hop: number;
  entities: ImpactedEntity[];
}

export function Canvas({
  rootName,
  rootEntityId,
  rootEntityType,
  impacted,
  selectedId,
  onSelect,
}: CanvasProps) {
  const columns = useMemo<Column[]>(() => {
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

  const selected = impacted.find((e) => e.entityId === selectedId) ?? null;

  /** Ids on the traced path, including the root. */
  const tracedIds = useMemo(() => {
    if (!selected) return null;
    return new Set(selected.shortestPath.nodes.map((n) => n.id));
  }, [selected]);

  const isDimmed = (id: string) => tracedIds !== null && !tracedIds.has(id);

  return (
    <div className="nf-scroll h-full overflow-x-auto overflow-y-auto p-6">
      <div className="flex min-w-max items-start gap-5">
        {/* Column 0 — the change itself */}
        <section aria-label="The change" className="w-60 shrink-0">
          <ColumnHeader hop={0} label="changed" count={1} />
          <article
            className={`nf-anim border-2 border-[var(--color-accent)] bg-[var(--color-surface-2)] p-3 ${
              tracedIds !== null && !tracedIds.has(rootEntityId) ? "nf-dimmed" : ""
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
            className="w-60 shrink-0"
          >
            <ColumnHeader
              hop={col.hop}
              label={col.hop === 1 ? "direct" : "indirect"}
              count={col.entities.length}
            />
            <ul className="space-y-2">
              {col.entities.map((e) => (
                <li key={e.entityId}>
                  <EntityNode
                    entity={e}
                    selected={e.entityId === selectedId}
                    dimmed={isDimmed(e.entityId)}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {impacted.length === 0 && (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
          No dependent entities were found within the traversal bound.
        </p>
      )}
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
}: {
  entity: ImpactedEntity;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const uncertain = entity.evidenceStatus !== "COMPLETE";

  return (
    <button
      type="button"
      onClick={() => onSelect(entity.entityId)}
      aria-pressed={selected}
      className={[
        "nf-anim w-full border p-3 text-left",
        // Uncertainty is FORM: dashed + hollow, never a colour alone.
        uncertain
          ? "border-dashed border-[var(--color-sev-warn)] bg-transparent"
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
        {uncertain && (
          <span className="text-[var(--color-sev-warn)]">partial evidence</span>
        )}
      </div>
    </button>
  );
}
