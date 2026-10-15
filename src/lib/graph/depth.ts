import { z } from "zod";

/**
 * Traversal-depth validation.
 *
 * This is a security boundary, not a convenience check.
 *
 * openCypher does not accept a parameter inside a variable-length pattern
 * (`*1..n`), so the depth is the ONE value in this codebase that is
 * interpolated into a query string. Everything that reaches that interpolation
 * must therefore be proven to be a small, finite, non-negative integer first.
 *
 * Rules:
 *  - no string input is accepted, and no coercion is performed. `"3"` is
 *    rejected outright, which is what makes `"3 OR 1=1"` and `"2; MATCH ..."`
 *    structurally impossible rather than merely filtered.
 *  - `.int()` rejects fractions, NaN, and both infinities.
 *  - the range is clamped to a hard ceiling the caller cannot raise.
 */

/** Hard ceiling on traversal depth, independent of caller input. */
export const MAX_TRAVERSAL_DEPTH = 8;
export const MIN_TRAVERSAL_DEPTH = 1;

/** Documented safe default, applied only when depth is entirely absent. */
export const DEFAULT_TRAVERSAL_DEPTH = 6;

export class InvalidDepthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDepthError";
  }
}

/**
 * Strict: rejects anything that is not a finite integer in range.
 *
 * `z.number()` performs no coercion, so strings never pass. `.int()` rejects
 * `2.5`, `NaN`, `Infinity`, and `-Infinity`.
 */
export const DepthSchema = z
  .number({ message: "depth must be a number, not a string or other type" })
  .int("depth must be an integer")
  .min(MIN_TRAVERSAL_DEPTH, `depth must be >= ${MIN_TRAVERSAL_DEPTH}`)
  .max(MAX_TRAVERSAL_DEPTH, `depth must be <= ${MAX_TRAVERSAL_DEPTH}`);

/**
 * Validate a depth value, applying the documented default only when the input
 * is absent (`undefined`). `null`, strings, and malformed values are errors,
 * never silently defaulted.
 */
export function parseDepth(input: unknown): number {
  const value = input === undefined ? DEFAULT_TRAVERSAL_DEPTH : input;

  const result = DepthSchema.safeParse(value);
  if (!result.success) {
    const why = result.error.issues.map((i) => i.message).join("; ");
    // Describe the rejected input by type, never by echoing an arbitrary
    // attacker-supplied string back into a message that may be logged.
    throw new InvalidDepthError(
      `Invalid traversal depth (${typeof value}): ${why}. ` +
        `Depth must be an integer in ${MIN_TRAVERSAL_DEPTH}..${MAX_TRAVERSAL_DEPTH}.`,
    );
  }
  return result.data;
}

/**
 * Back-compatible alias used by the query builders. Kept so that every call
 * site funnels through exactly one validator.
 */
export function assertDepth(depth: unknown): number {
  return parseDepth(depth);
}
