import { roQuery } from "../falkor/client";
import { ensureSeeded } from "../graph/seed";
import type { DomainPack } from "../graph/domain-pack";

/**
 * Question suggestion and intent resolution.
 *
 * Two jobs, both deterministic and both grounded in the loaded graph:
 *
 * 1. Suggest questions the CURRENT graph can genuinely answer. Suggestions
 *    are built from real entities and real counts, so they can never offer
 *    something the data cannot support.
 * 2. Resolve a free-text question to a supported intent plus the entities it
 *    refers to. This runs WITHOUT a language model, so the question interface
 *    keeps working when the agent is disabled or unaffordable.
 *
 * A model, when enabled, plans which tools to call. It never decides what is
 * true -- that always comes from FalkorDB.
 */

export type Intent =
  | "IMPACT"
  | "WHY_AFFECTED"
  | "EVIDENCE"
  | "UNKNOWNS"
  | "ACTIONS"
  | "SCOPE"
  | "UNSUPPORTED";

export interface SuggestedQuestion {
  id: string;
  text: string;
  intent: Intent;
  /** Entity the question is about, when it targets one. */
  entityId?: string;
  /** Why this graph can answer it. Shown on hover. */
  basis: string;
}

export interface GraphFacts {
  entities: Array<{ id: string; type: string; name: string; dependentCount: number }>;
  multiRoute: Array<{ id: string; name: string; routes: number }>;
  topRoot: { id: string; name: string; dependentCount: number } | null;
}

/** Read the small set of facts needed to build grounded suggestions. */
export async function readGraphFacts(
  graphName: string,
  pack?: DomainPack,
): Promise<GraphFacts> {
  await ensureSeeded(graphName, pack);

  const entitiesRes = await roQuery<{
    id: string;
    type: string;
    name: string;
    dependentCount: number;
  }>(
    graphName,
    `
MATCH (e:Entity)
OPTIONAL MATCH (d:Entity)-[:DEPENDS_ON]->(e)
WITH e, count(d) AS dependentCount
RETURN e.id AS id, e.type AS type, e.name AS name, dependentCount AS dependentCount
ORDER BY dependentCount DESC, id
`.trim(),
  );

  // Entities reachable from the busiest root by more than one distinct route.
  const entities = entitiesRes.data;
  // The pack names the entity its flagship investigation starts from; fall
  // back to whatever has the most dependents.
  const topRoot =
    (pack ? entities.find((e) => e.id === pack.scenarioRootId) : undefined) ??
    entities.find((e) => e.dependentCount > 0) ??
    null;

  let multiRoute: GraphFacts["multiRoute"] = [];
  if (topRoot) {
    const res = await roQuery<{ id: string; name: string; routes: number }>(
      graphName,
      `
MATCH p = (affected:Entity)-[:DEPENDS_ON*1..6]->(root:Entity {id: $rootId})
WHERE affected.id <> $rootId
  AND ALL(x IN nodes(p) WHERE size([y IN nodes(p) WHERE y.id = x.id]) = 1)
RETURN affected.id AS id, affected.name AS name, count(p) AS routes
ORDER BY routes DESC, id
`.trim(),
      { params: { rootId: topRoot.id } },
    );
    multiRoute = res.data.filter((r) => r.routes > 1);
  }

  return {
    entities,
    multiRoute,
    topRoot: topRoot
      ? { id: topRoot.id, name: topRoot.name, dependentCount: topRoot.dependentCount }
      : null,
  };
}

/**
 * Build 4-6 suggestions from real graph content.
 *
 * Every suggestion names a real entity and states the basis on which the
 * graph can answer it. If the graph lacks the structure for a suggestion, it
 * is simply not offered.
 */
export function suggestQuestions(facts: GraphFacts): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const root = facts.topRoot;

  if (root) {
    out.push({
      id: "q_impact_root",
      text: `What is exposed if ${root.name} becomes unavailable?`,
      intent: "IMPACT",
      entityId: root.id,
      basis: `${root.dependentCount} entities depend on this one directly.`,
    });
  }

  const multi = facts.multiRoute[0];
  if (multi && root) {
    out.push({
      id: "q_why_multi",
      text: `Why is ${multi.name} affected, and by how many independent routes?`,
      intent: "WHY_AFFECTED",
      entityId: multi.id,
      basis: `${multi.routes} distinct dependency routes reach this entity.`,
    });
  }

  const furthest = facts.multiRoute[facts.multiRoute.length - 1] ?? multi;
  if (furthest && root && furthest.id !== multi?.id) {
    out.push({
      id: "q_evidence_entity",
      text: `What evidence supports ${furthest.name} being affected?`,
      intent: "EVIDENCE",
      entityId: furthest.id,
      basis: "Every dependency edge cites a source record.",
    });
  } else if (multi && root) {
    out.push({
      id: "q_evidence_entity",
      text: `What evidence supports ${multi.name} being affected?`,
      intent: "EVIDENCE",
      entityId: multi.id,
      basis: "Every dependency edge cites a source record.",
    });
  }

  if (root) {
    out.push({
      id: "q_unknowns",
      text: "Which findings have incomplete or unresolved evidence?",
      intent: "UNKNOWNS",
      entityId: root.id,
      basis: "Evidence completeness is tracked per dependency edge.",
    });
    out.push({
      id: "q_actions",
      text: "What actions are proposed, and who must approve them?",
      intent: "ACTIONS",
      entityId: root.id,
      basis: "Proposals are generated by deterministic rules from the findings.",
    });
  }

  out.push({
    id: "q_scope",
    text: "What organization is loaded, and what can you actually answer?",
    intent: "SCOPE",
    basis: "Describes the loaded graph without claiming outside knowledge.",
  });

  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ *
 * Deterministic intent resolution (no model required)
 * ------------------------------------------------------------------ */

/**
 * Order matters: the FIRST match wins, so more specific intents come first.
 * "which findings have incomplete evidence?" mentions evidence but is really
 * asking about gaps, so UNKNOWNS must outrank EVIDENCE.
 */
const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "UNKNOWNS",
    patterns: [
      /\b(unknown|uncertain|incomplete|missing|unresolved|unsupported)\b/i,
      /\bgaps?\b/i,
      /\bnot sure|unclear\b/i,
      /\bpartial\b/i,
    ],
  },
  {
    intent: "EVIDENCE",
    patterns: [
      /\bevidence\b/i,
      /\b(prove|proof)\b/i,
      /how do (you|we) know/i,
      /\bsources?\b/i,
      /\b(cite|citation)\b/i,
      /\bverif(y|ied|ication)\b/i,
      /\bexcerpt|document|record\b/i,
    ],
  },
  {
    intent: "ACTIONS",
    patterns: [
      /\baction(s)?\b/i,
      /what should (we|i) do/i,
      /\bapprov(e|al)\b/i,
      /\brecommend(ation)?(s)?\b/i,
      /\bnext step(s)?\b/i,
      /\bwho (must|should|can)\b/i,
    ],
  },
  {
    intent: "SCOPE",
    patterns: [
      // Tolerant of adverbs: "what can you actually answer".
      /what can (you|nexusforge)\b[^?]*\b(do|answer|tell|handle|support)/i,
      /\bwhat (data|organization|organisation|company|graph|dataset)\b/i,
      /\bwho are you\b/i,
      /\bwhat are your (capabilities|limits)\b/i,
      /\bcapabilit(y|ies)\b/i,
      /\bwhich organization\b/i,
    ],
  },
  {
    intent: "WHY_AFFECTED",
    patterns: [
      /\bwhy\b/i,
      /\bhow is .* (affected|connected|related|linked)/i,
      /\b(paths?|routes?|chain)\b/i,
      /\bconnect(ed|ion)?\b/i,
    ],
  },
  {
    intent: "IMPACT",
    patterns: [
      /what (is|are|would be) (exposed|affected|impacted|at risk)/i,
      /what happens if/i,
      /\bimpact\b/i,
      /\b(leaves|leaving|resigns|resigning|quits|fails|unavailable|removed|losing|lost|down|outage)\b/i,
      /\bdepends?\b|\bdependents?\b|\bdependenc(y|ies)\b/i,
    ],
  },
];

export interface ResolvedQuestion {
  intent: Intent;
  /** Entities named in the question, resolved against the real graph. */
  entityIds: string[];
  /** Entity the analysis runs FROM (the thing that changed). */
  rootEntityId: string | null;
  /**
   * Entity the question is ABOUT, when different from the root.
   *
   * "Why is X affected?" names X as the subject of the question, but the
   * analysis still has to run from whatever changed. Conflating the two made
   * the target lookup come back empty.
   */
  targetEntityId: string | null;
  /** Populated when the question cannot be served. */
  unsupportedReason?: string;
  clarification?: string;
}

/**
 * Resolve free text to an intent and real entities.
 *
 * Entity resolution is literal: a question only refers to an entity if the
 * entity's name or id actually appears in it (token overlap). Nothing is
 * guessed, so a question about a company we have no data for resolves to
 * nothing and is reported as unsupported.
 */
export function resolveQuestion(
  question: string,
  facts: GraphFacts,
  defaultRootId: string | null,
): ResolvedQuestion {
  const q = question.trim();
  if (q.length === 0) {
    return {
      intent: "UNSUPPORTED",
      entityIds: [],
      rootEntityId: null,
      targetEntityId: null,
      unsupportedReason: "The question was empty.",
      clarification: "Try one of the suggested questions.",
    };
  }

  const matched = matchEntities(q, facts);
  const intent = detectIntent(q);

  if (intent === "SCOPE") {
    return { intent, entityIds: matched, rootEntityId: null, targetEntityId: null };
  }

  if (intent === "UNSUPPORTED") {
    return {
      intent: "UNSUPPORTED",
      entityIds: matched,
      rootEntityId: null,
      targetEntityId: null,
      unsupportedReason:
        "This question does not map to an investigation this graph supports.",
      clarification:
        "NexusForge answers questions about dependency exposure, why something is affected, " +
        "the evidence behind a finding, evidence gaps, and proposed actions.",
    };
  }

  // Who is the subject, and what are we analysing from?
  //
  // IMPACT asks about the thing that CHANGED, so a named entity is the root.
  // WHY_AFFECTED and EVIDENCE ask about a thing that was AFFECTED, so a named
  // entity is the target and the root falls back to the changed entity.
  const subjectIsTarget = intent === "WHY_AFFECTED" || intent === "EVIDENCE";

  let rootEntityId: string | null;
  let targetEntityId: string | null;

  if (subjectIsTarget) {
    targetEntityId = matched[0] ?? null;
    // A second named entity, if present, is the thing that changed.
    rootEntityId = matched.find((id) => id !== targetEntityId) ?? defaultRootId;
  } else {
    rootEntityId = matched[0] ?? defaultRootId;
    targetEntityId = matched.find((id) => id !== rootEntityId) ?? null;
  }

  if (!rootEntityId) {
    return {
      intent: "UNSUPPORTED",
      entityIds: matched,
      rootEntityId: null,
      targetEntityId: null,
      unsupportedReason: "No entity in the loaded graph matched this question.",
      clarification: "Name an entity that exists in the loaded organization.",
    };
  }

  if (subjectIsTarget && !targetEntityId) {
    return {
      intent: "UNSUPPORTED",
      entityIds: matched,
      rootEntityId: null,
      targetEntityId: null,
      unsupportedReason: "No entity in the loaded graph matched this question.",
      clarification:
        "Name which affected entity you mean, using a name from the loaded organization.",
    };
  }

  return { intent, entityIds: matched, rootEntityId, targetEntityId };
}

function detectIntent(q: string): Intent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(q))) return intent;
  }
  return "UNSUPPORTED";
}

/** Literal name/id matching against real entities. No fuzzy invention. */
function matchEntities(q: string, facts: GraphFacts): string[] {
  const lower = q.toLowerCase();
  const hits: Array<{ id: string; score: number }> = [];

  for (const e of facts.entities) {
    if (lower.includes(e.id.toLowerCase())) {
      hits.push({ id: e.id, score: 1000 });
      continue;
    }
    const name = e.name.toLowerCase();
    if (lower.includes(name)) {
      hits.push({ id: e.id, score: 500 + name.length });
      continue;
    }
    // Distinctive multi-character tokens from the name, e.g. a surname.
    const tokens = name
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    const overlap = tokens.filter((t) => lower.includes(t));
    if (overlap.length > 0 && overlap.length >= Math.min(2, tokens.length)) {
      hits.push({ id: e.id, score: overlap.join("").length });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .map((h) => h.id)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}
