/**
 * READ-ONLY contamination audit.
 *
 * Looks for records belonging to one domain pack inside another
 * organization's graph. Uses roQuery exclusively, so it physically cannot
 * modify anything: the server rejects writes on that channel.
 *
 * Reports only. Never cleans up.
 */
import { loadLocalEnv } from "./_env";

loadLocalEnv();

const { roQuery, closeDb, listGraphs } = await import("../src/lib/falkor/client");
const { ORGANIZATIONS } = await import("../src/lib/org/registry");
const { orgContext } = await import("../src/lib/org/packs");

interface Row {
  id: string;
  type?: string;
  name?: string;
  domain?: string;
}

async function auditGraph(orgId: string): Promise<void> {
  const { org, pack, graphName } = orgContext(orgId);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${org.label}  —  graph ${graphName}`);
  console.log(`expected pack: ${pack.domain} (${pack.seedVersion})`);
  console.log("=".repeat(70));

  const expectedEntityIds = new Set(pack.entities.map((e) => e.id));
  const expectedSourceIds = new Set(pack.sources.map((s) => s.id));

  // Seed marker: which pack last claimed this graph?
  const marker = await roQuery<{ seedVersion: string; domain: string; complete: boolean }>(
    graphName,
    `MATCH (m:SeedMarker {id:'seed_marker'})
     RETURN m.seedVersion AS seedVersion, m.domain AS domain, m.complete AS complete`,
  );
  const m = marker.data[0];
  console.log(
    `seed marker  : ${m ? `${m.domain} / ${m.seedVersion} / complete=${m.complete}` : "ABSENT"}`,
  );
  if (m && m.seedVersion !== pack.seedVersion) {
    console.log(`  *** MARKER MISMATCH: expected ${pack.seedVersion}, found ${m.seedVersion}`);
  }

  // Census.
  const census = await roQuery<{ label: string; c: number }>(
    graphName,
    `MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY label`,
  );
  console.log(`census       : ${census.data.map((r) => `${r.label}=${r.c}`).join(", ")}`);

  // Entities whose domain property disagrees with this pack.
  const foreignDomain = await roQuery<Row>(
    graphName,
    `MATCH (e:Entity) WHERE e.domain <> $domain
     RETURN e.id AS id, e.type AS type, e.name AS name, e.domain AS domain
     ORDER BY id`,
    { params: { domain: pack.domain } },
  );
  console.log(`foreign-domain entities: ${foreignDomain.data.length}`);
  for (const r of foreignDomain.data.slice(0, 25)) {
    console.log(`  - ${r.id}  [domain=${r.domain}] ${r.name ?? ""}`);
  }

  // Entities not present in this pack at all.
  const allEntities = await roQuery<Row>(
    graphName,
    `MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.domain AS domain ORDER BY id`,
  );
  const unexpectedEntities = allEntities.data.filter((r) => !expectedEntityIds.has(r.id));
  console.log(`entities not in pack   : ${unexpectedEntities.length}`);
  for (const r of unexpectedEntities.slice(0, 25)) {
    console.log(`  - ${r.id}  [domain=${r.domain}] ${r.name ?? ""}`);
  }

  // Sources not present in this pack.
  const allSources = await roQuery<Row>(
    graphName,
    `MATCH (s:Source) RETURN s.id AS id, s.sourceType AS type ORDER BY id`,
  );
  const unexpectedSources = allSources.data.filter((r) => !expectedSourceIds.has(r.id));
  console.log(`sources not in pack    : ${unexpectedSources.length}`);
  for (const r of unexpectedSources.slice(0, 25)) {
    console.log(`  - ${r.id}  [${r.type}]`);
  }

  // The specific smoking gun named in the audit.
  // These records legitimately exist in the education graph, so the check
  // only means something in a graph that is NOT the education organization.
  const resignation = await roQuery<{ c: number }>(
    graphName,
    `MATCH (s:Source {id:'src_resignation_okonkwo_2026_10_12'}) RETURN count(s) AS c`,
  );
  const okonkwo = await roQuery<{ c: number }>(
    graphName,
    `MATCH (e:Entity {id:'ent_person_okonkwo'}) RETURN count(e) AS c`,
  );
  const eduMarkers = (resignation.data[0]?.c ?? 0) + (okonkwo.data[0]?.c ?? 0);
  const eduMarkersAreForeign = org.id !== "education";
  console.log(
    `education markers      : resignation-letter=${resignation.data[0]?.c ?? 0}, ` +
      `ent_person_okonkwo=${okonkwo.data[0]?.c ?? 0}` +
      (eduMarkersAreForeign ? "  (any non-zero = contamination)" : "  (expected here)"),
  );

  const verdict =
    foreignDomain.data.length === 0 &&
    unexpectedEntities.length === 0 &&
    unexpectedSources.length === 0 &&
    (!eduMarkersAreForeign || eduMarkers === 0) &&
    (!m || m.seedVersion === pack.seedVersion);
  console.log(`\nVERDICT: ${verdict ? "CLEAN" : "*** CONTAMINATED ***"}`);
}

try {
  const graphs = await listGraphs();
  console.log(`graphs on instance: ${graphs.join(", ")}`);
  for (const orgId of Object.keys(ORGANIZATIONS)) {
    await auditGraph(orgId);
  }
  console.log("\n(read-only: nothing was modified)");
} catch (err) {
  console.error(`AUDIT FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
