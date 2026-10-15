import { NextResponse } from "next/server";
import { roQuery } from "@/lib/falkor/client";
import { getEnv } from "@/lib/env";
import { ensureSeeded } from "@/lib/graph/seed";
import { errorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; must be a literal for Next segment config

/**
 * Candidate entities a change can be analysed from.
 *
 * Returned from the graph rather than hardcoded, so the UI's entity picker is
 * driven by whatever domain pack is loaded -- no school vocabulary in the
 * application layer.
 *
 * `dependentCount` lets the UI show which entities actually have downstream
 * exposure without running a full analysis.
 */
export async function GET() {
  try {
    const graphName = getEnv().FALKORDB_GRAPH;
    await ensureSeeded(graphName);

    const res = await roQuery<{
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

    return NextResponse.json({ entities: res.data, graphName });
  } catch (err) {
    return errorResponse(err);
  }
}
