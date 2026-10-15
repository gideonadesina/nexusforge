/**
 * Integration-test helpers.
 *
 * Every test run builds its own uniquely named `nf_test_*` graph and deletes
 * only that graph afterwards. Pre-existing graphs are never touched.
 */
import { dropGraph } from "../src/lib/falkor/client";

export function uniqueTestGraph(label: string): string {
  const safe = label.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  return `nf_test_${safe}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function cleanupGraph(name: string): Promise<void> {
  if (!name.startsWith("nf_test_") && !name.startsWith("nf_probe_")) {
    throw new Error(`Refusing to delete "${name}": not a test-owned graph.`);
  }
  await dropGraph(name);
}
