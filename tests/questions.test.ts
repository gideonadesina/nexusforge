/**
 * Natural-language question workflow — deterministic path.
 *
 * Covers the four cases required: a supported suggested question, a
 * paraphrase, an evidence question, and an unsupported/ambiguous question.
 *
 * Real FalkorDB. No OpenAI calls.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedEducationGraph } from "../src/lib/graph/seed";
import { readGraphFacts, suggestQuestions, resolveQuestion } from "../src/lib/agent/questions";
import { EDUCATION_PACK } from "../src/lib/graph/seed";
import { composeAnswer } from "../src/lib/agent/answer";
import { publicView, resolveOrg } from "../src/lib/org/registry";

const EDU_ORG = publicView(resolveOrg("education"));
import { closeDb } from "../src/lib/falkor/client";
import { uniqueTestGraph, cleanupGraph } from "./helpers";
import type { GraphFacts } from "../src/lib/agent/questions";

const graphName = uniqueTestGraph("questions");
let facts: GraphFacts;
let defaultRoot: string;

beforeAll(async () => {
  await seedEducationGraph(graphName);
  facts = await readGraphFacts(graphName, EDUCATION_PACK);
  defaultRoot = facts.topRoot!.id;
}, 180_000);

afterAll(async () => {
  await cleanupGraph(graphName);
  await closeDb();
});

describe("suggestions are grounded in the loaded graph", () => {
  it("offers between 4 and 6 questions", () => {
    const s = suggestQuestions(facts);
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.length).toBeLessThanOrEqual(6);
  });

  it("names only entities that really exist", () => {
    const ids = new Set(facts.entities.map((e) => e.id));
    for (const q of suggestQuestions(facts)) {
      if (q.entityId) expect(ids.has(q.entityId)).toBe(true);
    }
  });

  it("states a basis for every suggestion", () => {
    for (const q of suggestQuestions(facts)) {
      expect(q.basis.length).toBeGreaterThan(0);
      expect(q.text.length).toBeGreaterThan(0);
    }
  });

  it("every suggestion resolves to a supported intent", () => {
    for (const q of suggestQuestions(facts)) {
      const r = resolveQuestion(q.text, facts, defaultRoot);
      expect(r.intent, `"${q.text}" must be supported`).not.toBe("UNSUPPORTED");
    }
  });
});

describe("case 1 — a supported suggested question", () => {
  it("answers the impact question from graph values", async () => {
    const q = suggestQuestions(facts).find((s) => s.intent === "IMPACT")!;
    const resolved = resolveQuestion(q.text, facts, defaultRoot);
    expect(resolved.intent).toBe("IMPACT");

    const answer = await composeAnswer(graphName, resolved, EDU_ORG);
    expect(answer.supported).toBe(true);
    expect(answer.analysis).not.toBeNull();
    // The stated count must equal the computed count.
    expect(answer.text).toContain(String(answer.analysis!.distinctImpactedCount));
    expect(answer.text).toMatch(/not operational failure/i);
  }, 60_000);
});

describe("case 2 — paraphrases resolve to the same intent", () => {
  it.each([
    "what happens if Okonkwo leaves?",
    "if A. Okonkwo resigns, what is affected?",
    "show me the impact of losing Okonkwo",
    "what depends on Okonkwo?",
  ])("resolves %s to IMPACT with the right root", (text) => {
    const r = resolveQuestion(text, facts, defaultRoot);
    expect(r.intent).toBe("IMPACT");
    expect(r.rootEntityId).toBe("ent_person_okonkwo");
  });

  it.each([
    "why is the WAEC Physics mock examination affected?",
    "how is the WAEC Physics mock examination connected to this?",
  ])("resolves %s to WHY_AFFECTED", (text) => {
    const r = resolveQuestion(text, facts, defaultRoot);
    expect(r.intent).toBe("WHY_AFFECTED");
    expect(r.entityIds).toContain("ent_exam_waec_mock_physics");
  });

  it("explains the real chain, not a plausible one", async () => {
    const r = resolveQuestion(
      "why is the WAEC Physics mock examination affected?",
      facts,
      defaultRoot,
    );
    const answer = await composeAnswer(graphName, r, EDU_ORG);
    const hit = answer.analysis!.impacted.find(
      (e) => e.entityId === "ent_exam_waec_mock_physics",
    )!;
    expect(answer.text).toContain(hit.shortestPath.nodes.map((n) => n.id).join(" -> "));
    expect(answer.text).toContain(String(hit.allPaths.length));
  }, 60_000);
});

describe("case 3 — evidence questions cite real sources", () => {
  it("quotes excerpts that exist on Source nodes", async () => {
    const r = resolveQuestion(
      "what evidence supports the WAEC Physics mock examination being affected?",
      facts,
      defaultRoot,
    );
    expect(r.intent).toBe("EVIDENCE");

    const answer = await composeAnswer(graphName, r, EDU_ORG);
    expect(answer.citedSourceIds.length).toBeGreaterThan(0);

    const hit = answer.analysis!.impacted.find(
      (e) => e.entityId === "ent_exam_waec_mock_physics",
    )!;
    for (const ev of hit.evidence) {
      expect(answer.text).toContain(ev.excerpt);
    }
  }, 60_000);

  it("reports evidence gaps honestly when asked about unknowns", async () => {
    const r = resolveQuestion("which findings have incomplete evidence?", facts, defaultRoot);
    expect(r.intent).toBe("UNKNOWNS");
    const answer = await composeAnswer(graphName, r, EDU_ORG);
    // The clean seed has none, and the answer must say so rather than invent.
    expect(answer.text).toMatch(/no finding has unresolved evidence/i);
    expect(answer.supported).toBe(true);
  }, 60_000);
});

describe("case 4 — unsupported and ambiguous questions", () => {
  it.each([
    "what is the share price of Tesla?",
    "write me a poem about graphs",
    "who won the world cup",
  ])("refuses %s and explains what it can do", async (text) => {
    const r = resolveQuestion(text, facts, defaultRoot);
    expect(r.intent).toBe("UNSUPPORTED");
    const answer = await composeAnswer(graphName, r, EDU_ORG);
    expect(answer.supported).toBe(false);
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.analysis).toBeNull();
  });

  it("does not invent an entity that is not in the graph", () => {
    const r = resolveQuestion(
      "what is exposed if Acme Corporation's CFO resigns?",
      facts,
      defaultRoot,
    );
    // It may fall back to the default root, but must never claim Acme exists.
    expect(r.entityIds).not.toContain("acme");
    expect(facts.entities.some((e) => /acme/i.test(e.name))).toBe(false);
  });

  it("asks for clarification when an entity is needed but none matches", () => {
    const emptyFacts: GraphFacts = { entities: [], multiRoute: [], topRoot: null };
    const r = resolveQuestion("why is it affected?", emptyFacts, null);
    expect(r.intent).toBe("UNSUPPORTED");
    expect(r.clarification).toBeTruthy();
  });

  it("answers a scope question without claiming outside knowledge", async () => {
    const r = resolveQuestion("what can you actually answer?", facts, defaultRoot);
    expect(r.intent).toBe("SCOPE");
    const answer = await composeAnswer(graphName, r, EDU_ORG);
    expect(answer.text).toMatch(/synthetic/i);
    expect(answer.text).toMatch(/no knowledge of any real organization/i);
  });
});
