/**
 * Does a question name a specific subject this dataset does not hold?
 *
 * Capitalised multi-word names and possessives are the common signal
 * ("Acme Corporation's CFO", "Globex Industries"). Conservative on purpose:
 * a false positive costs one clarification prompt, while a false negative
 * produces a confident answer about an entity the user never asked about.
 *
 * Lives in its own module purely so the patterns are easy to read and test.
 */

/** Words that start a sentence or are common nouns, not organization names. */
const SENTENCE_STARTERS = new Set([
  "What", "Why", "How", "When", "Which", "Who", "Where", "Show", "List",
  "Is", "Are", "Does", "Do", "Can", "Could", "Would", "Should", "If", "The",
]);

export function mentionsForeignSubject(q: string): boolean {
  // "Acme's", "Globex's"
  if (/\b[A-Z][a-zA-Z]+'s\b/.test(q)) return true;

  // Two or more consecutive capitalised words, e.g. "Acme Corporation".
  const multiWord = q.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  for (const phrase of multiWord) {
    const first = phrase.split(/\s+/)[0] ?? "";
    // Ignore phrases that merely begin a sentence.
    if (!SENTENCE_STARTERS.has(first)) return true;
  }
  return false;
}
