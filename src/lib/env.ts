import { z } from "zod";
import { assertServerOnly } from "./server-guard";

/**
 * Server-side environment validation.
 *
 * Nothing in here ever prints a value. Errors report variable NAMES only.
 */

/** Every graph this project may touch must carry this prefix (Guardrail 6). */
export const GRAPH_PREFIX = "nf_";

const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no", ""]))
  .transform((v) => v === "true" || v === "1" || v === "yes");

const EnvSchema = z.object({
  FALKORDB_HOST: z.string().min(1),
  FALKORDB_PORT: z.coerce.number().int().positive().max(65535),
  FALKORDB_USERNAME: z.string().min(1).default("default"),
  FALKORDB_PASSWORD: z.string().min(1),
  FALKORDB_TLS: booleanish.default(false),
  FALKORDB_GRAPH: z
    .string()
    .min(GRAPH_PREFIX.length + 1)
    .startsWith(GRAPH_PREFIX, `graph name must start with "${GRAPH_PREFIX}"`)
    .default("nf_demo_education"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Parse and cache the environment. Throws a redacted error listing only the
 * names of the variables that failed validation.
 */
export function getEnv(): Env {
  assertServerOnly("getEnv");
  if (cached) return cached;

  const parsed = EnvSchema.safeParse({
    FALKORDB_HOST: process.env.FALKORDB_HOST,
    FALKORDB_PORT: process.env.FALKORDB_PORT,
    FALKORDB_USERNAME: process.env.FALKORDB_USERNAME,
    FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD,
    FALKORDB_TLS: process.env.FALKORDB_TLS,
    FALKORDB_GRAPH: process.env.FALKORDB_GRAPH,
  });

  if (!parsed.success) {
    // Report names + reasons only. Never the offending values.
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .sort()
      .join("; ");
    throw new Error(
      `Invalid FalkorDB environment configuration. Check .env.local. Problems: ${problems}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * Mask a hostname for logging: keep enough to identify the deployment, hide
 * the rest. "r-abc123.instance-xyz.example.cloud" -> "r-ab***.***.cloud".
 */
export function maskHost(host: string): string {
  const parts = host.split(".");
  const head = parts[0] ?? "";
  const tld = parts.length > 1 ? parts[parts.length - 1] : "";
  const visible = head.slice(0, 2);
  return parts.length > 1 ? `${visible}***.***.${tld}` : `${visible}***`;
}

/**
 * Description of the configured target that is safe to log.
 *
 * The host is masked: it is the address of a live instance and is treated as
 * sensitive infrastructure detail, not public information.
 */
export function describeTarget(env: Env): string {
  return `${maskHost(env.FALKORDB_HOST)}:${env.FALKORDB_PORT} tls=${env.FALKORDB_TLS} graph=${env.FALKORDB_GRAPH}`;
}
