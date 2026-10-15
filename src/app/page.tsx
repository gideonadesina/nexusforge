/**
 * Stage 1 placeholder page.
 *
 * Deliberately static: the Stage 1 deliverable is a verified graph engine
 * exercised from the CLI and the integration suite, not a UI. This page makes
 * no database call so that `next build` never depends on a live instance.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">NexusForge</h1>
      <p className="mt-3 text-neutral-400">
        Cross-sector organizational intelligence engine backed by FalkorDB.
      </p>

      <div className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
          Stage 1 — walking skeleton
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-300">
          The verified capability is a deterministic, evidence-backed dependency
          impact analysis computed by FalkorDB. There is no interface yet. Run it
          with:
        </p>
        <pre className="mt-4 overflow-x-auto rounded bg-black/60 p-3 text-xs text-neutral-200">
          npm run seed{"\n"}npm run impact{"\n"}npm test
        </pre>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        All demonstration data is synthetic. No real person, institution, or
        document is represented.
      </p>
    </main>
  );
}
