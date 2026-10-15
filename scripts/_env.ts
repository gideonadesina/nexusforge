/**
 * Loads .env.local for standalone Node scripts and the Vitest suite.
 * Next.js loads .env.local automatically; plain `tsx`/vitest processes do not.
 *
 * Never prints a value.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");

export function loadLocalEnv(): { loaded: boolean; names: string[] } {
  if (!existsSync(ENV_FILE)) {
    return { loaded: false, names: [] };
  }
  const result = config({ path: ENV_FILE, quiet: true });
  const names = Object.keys(result.parsed ?? {}).sort();
  return { loaded: true, names };
}
