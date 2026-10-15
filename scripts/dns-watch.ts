/**
 * Timeboxed connectivity diagnosis (Stage 2A, requirement 13).
 *
 * Repeatedly samples three independent layers to classify failures:
 *   L1 DNS   — can the hostname be resolved at all?
 *   L2 TCP   — can a socket be opened once the name resolves?
 *   L3 QUERY — does FalkorDB accept a connection and answer a trivial query?
 *
 * A failure is attributed to the lowest layer that failed, so a DNS outage is
 * never misreported as a database problem.
 *
 * Prints masked hostnames only. No credentials. Read-only: the probe query is
 * `RETURN 1`, issued through RO_QUERY against an owned graph name.
 *
 * Usage: npx tsx scripts/dns-watch.ts [durationSeconds] [intervalSeconds]
 */
import { loadLocalEnv } from "./_env";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

loadLocalEnv();

const { getEnv, maskHost } = await import("../src/lib/env");

const DURATION_S = Number(process.argv[2] ?? 780); // 13 min default, inside the 15 min box
const INTERVAL_S = Number(process.argv[3] ?? 15);

const env = getEnv();
const host = env.FALKORDB_HOST;
const port = env.FALKORDB_PORT;

type Layer = "DNS" | "TCP" | "QUERY";

/** Count of asynchronous socket resets observed across the whole run. */
let socketResets = 0;

interface Sample {
  n: number;
  at: string;
  dnsMs: number | null;
  tcpMs: number | null;
  queryMs: number | null;
  failedLayer: Layer | null;
  code: string;
}

function now(): string {
  return new Date().toISOString();
}

async function timeDns(): Promise<{ ms: number; code: string | null }> {
  const t = Date.now();
  try {
    await lookup(host);
    return { ms: Date.now() - t, code: null };
  } catch (err) {
    return { ms: Date.now() - t, code: (err as NodeJS.ErrnoException).code ?? "DNS_ERR" };
  }
}

function timeTcp(timeoutMs = 10_000): Promise<{ ms: number; code: string | null }> {
  const t = Date.now();
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (code: string | null) => {
      sock.destroy();
      resolve({ ms: Date.now() - t, code });
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => done(null));
    sock.on("timeout", () => done("ETIMEDOUT"));
    sock.on("error", (e) => done((e as NodeJS.ErrnoException).code ?? "TCP_ERR"));
  });
}

/**
 * Layer 3 uses a fresh connection each sample so we measure real connect+auth
 * +query cost, not a warm pooled socket.
 */
async function timeQuery(): Promise<{ ms: number; code: string | null }> {
  const t = Date.now();
  const { FalkorDB } = await import("falkordb");
  let db: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;
  try {
    db = await FalkorDB.connect({
      socket: { host, port, tls: env.FALKORDB_TLS, connectTimeout: 10_000 },
      username: env.FALKORDB_USERNAME,
      password: env.FALKORDB_PASSWORD,
    });
    // Without this listener an 'error' event (e.g. ECONNRESET on an idle
    // socket) is re-thrown by Node and kills the whole diagnostic run.
    db.on("error", () => {
      socketResets += 1;
    });
    const g = db.selectGraph(env.FALKORDB_GRAPH);
    await g.roQuery(`RETURN 1 AS ok`, { TIMEOUT: 8000 });
    return { ms: Date.now() - t, code: null };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const code =
      (err as NodeJS.ErrnoException).code ??
      raw.split(host).join(maskHost(host)).slice(0, 80);
    return { ms: Date.now() - t, code };
  } finally {
    try {
      await db?.close();
    } catch {
      /* closing failure is not part of the measurement */
    }
  }
}

const samples: Sample[] = [];
const started = Date.now();
let n = 0;

console.log(`target: ${maskHost(host)}:${port} tls=${env.FALKORDB_TLS}`);
console.log(`duration: ${DURATION_S}s   interval: ${INTERVAL_S}s`);
console.log(`started: ${now()}`);
console.log("");
console.log("  #  timestamp                 DNS      TCP      QUERY    result");
console.log("---  ------------------------  -------  -------  -------  ------------------");

while ((Date.now() - started) / 1000 < DURATION_S) {
  n += 1;
  const at = now();

  const dns = await timeDns();
  let tcp: { ms: number; code: string | null } = { ms: 0, code: null };
  let q: { ms: number; code: string | null } = { ms: 0, code: null };
  let failedLayer: Layer | null = null;
  let code = "";

  if (dns.code) {
    failedLayer = "DNS";
    code = dns.code;
  } else {
    tcp = await timeTcp();
    if (tcp.code) {
      failedLayer = "TCP";
      code = tcp.code;
    } else {
      q = await timeQuery();
      if (q.code) {
        failedLayer = "QUERY";
        code = q.code;
      }
    }
  }

  const s: Sample = {
    n,
    at,
    dnsMs: dns.ms,
    tcpMs: dns.code ? null : tcp.ms,
    queryMs: failedLayer ? null : q.ms,
    failedLayer,
    code,
  };
  samples.push(s);

  const fmt = (v: number | null) => (v === null ? "   -   " : `${String(v).padStart(5)}ms`);
  console.log(
    `${String(n).padStart(3)}  ${at}  ${fmt(s.dnsMs)}  ${fmt(s.tcpMs)}  ${fmt(s.queryMs)}  ` +
      (failedLayer ? `FAIL ${failedLayer}: ${code}` : "ok"),
  );

  const remaining = DURATION_S - (Date.now() - started) / 1000;
  if (remaining <= 0) break;
  await new Promise((r) => setTimeout(r, Math.min(INTERVAL_S, remaining) * 1000));
}

// ---- summary ----------------------------------------------------------
const total = samples.length;
const failures = samples.filter((s) => s.failedLayer !== null);
const byLayer = (l: Layer) => failures.filter((s) => s.failedLayer === l).length;
const ok = samples.filter((s) => s.failedLayer === null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);

const codes = new Map<string, number>();
for (const f of failures) codes.set(f.code, (codes.get(f.code) ?? 0) + 1);

console.log("\n" + "=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log(`attempts            : ${total}`);
console.log(`successes           : ${ok.length}`);
console.log(`failures            : ${failures.length}`);
console.log(`  DNS layer         : ${byLayer("DNS")}`);
console.log(`  TCP layer         : ${byLayer("TCP")}`);
console.log(`  QUERY layer       : ${byLayer("QUERY")}`);
console.log(`DNS   avg/max ms    : ${avg(samples.map((s) => s.dnsMs ?? 0))} / ${max(samples.map((s) => s.dnsMs ?? 0))}`);
console.log(
  `TCP   avg/max ms    : ${avg(ok.map((s) => s.tcpMs ?? 0))} / ${max(ok.map((s) => s.tcpMs ?? 0))}`,
);
console.log(
  `QUERY avg/max ms    : ${avg(ok.map((s) => s.queryMs ?? 0))} / ${max(ok.map((s) => s.queryMs ?? 0))}`,
);
console.log(`error codes         : ${codes.size === 0 ? "(none)" : [...codes].map(([c, k]) => `${c} x${k}`).join(", ")}`);
console.log(`async socket resets : ${socketResets}`);

let classification: string;
if (failures.length === 0) classification = "NOT REPRODUCED in this window";
else if (failures.length === total) classification = "CONSISTENT failure";
else classification = `INTERMITTENT (${((failures.length / total) * 100).toFixed(1)}% failure rate)`;
console.log(`classification      : ${classification}`);
console.log(`finished            : ${now()}`);
