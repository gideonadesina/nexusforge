import { NextResponse } from "next/server";
import { ping } from "@/lib/falkor/client";
import { isSeeded } from "@/lib/graph/seed";
import { orgContext } from "@/lib/org/packs";
import { errorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Liveness probe that actually touches FalkorDB.
 *
 * A successful build proves nothing about database connectivity, so this
 * endpoint performs a real round trip and reports the measured latency. It
 * never returns credentials -- `ping()` reports a masked target.
 */
export async function GET() {
  const started = Date.now();
  try {
    const result = await ping();
    // Report the DEFAULT organization's graph, not a bare env fallback, so
    // health reflects what a visitor actually loads.
    const { org, pack, graphName } = orgContext(undefined);
    const seeded = await isSeeded(graphName, pack);

    return NextResponse.json({
      ok: true,
      target: result.target, // host is masked
      graphsOnInstance: result.graphs,
      organization: org.label,
      graphName,
      seeded,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    const res = errorResponse(err);
    res.headers.set("x-nf-latency-ms", String(Date.now() - started));
    return res;
  }
}
