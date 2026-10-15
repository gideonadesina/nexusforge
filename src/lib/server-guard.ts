/**
 * Runtime guard against credential-bearing code running in a browser bundle.
 *
 * We deliberately avoid the `server-only` package: its default export throws on
 * import in any non-React-Server environment, which would break the plain Node
 * scripts (`npm run seed`) and the Vitest integration suite. A runtime check
 * gives the same protection in the one place that matters while keeping the
 * module usable from Next server code, scripts, and tests alike.
 */
export function assertServerOnly(what: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${what}() is server-only and must never run in the browser. ` +
        `Call it from a server component, route handler, or Node script.`,
    );
  }
}
