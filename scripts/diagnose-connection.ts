/**
 * Network diagnosis for the configured FalkorDB target.
 *
 * Distinguishes "the whole machine is offline" from "this specific instance
 * hostname no longer resolves", which on the FalkorDB Cloud free tier is the
 * expected symptom of a stopped or reclaimed instance.
 *
 * Prints masked hostnames only. No credential values.
 */
import { loadLocalEnv } from "./_env";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

loadLocalEnv();

const { getEnv, maskHost } = await import("../src/lib/env");

const env = getEnv();
const host = env.FALKORDB_HOST;
const parts = host.split(".");

async function resolves(name: string): Promise<string> {
  try {
    const r = await lookup(name);
    return `OK (${r.family === 4 ? "IPv4" : "IPv6"})`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "ERR";
    return `FAIL (${code})`;
  }
}

function tcp(h: string, port: number, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    const sock = connect({ host: h, port });
    const done = (msg: string) => {
      sock.destroy();
      resolve(msg);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => done("OK (tcp connect)"));
    sock.on("timeout", () => done("FAIL (timeout)"));
    sock.on("error", (e) => done(`FAIL (${(e as NodeJS.ErrnoException).code ?? e.message})`));
  });
}

console.log("=== configured target (masked) ===");
console.log(`host:   ${maskHost(host)}`);
console.log(`port:   ${env.FALKORDB_PORT}`);
console.log(`tls:    ${env.FALKORDB_TLS}`);
console.log(`graph:  ${env.FALKORDB_GRAPH}`);
console.log(`host label count: ${parts.length}`);

console.log("\n=== baseline internet / DNS ===");
console.log(`resolve example.com:        ${await resolves("example.com")}`);
console.log(`resolve cloud.falkordb.com: ${await resolves("cloud.falkordb.com")}`);
console.log(`tcp example.com:443:        ${await tcp("example.com", 443)}`);

console.log("\n=== configured instance ===");
console.log(`resolve full host:          ${await resolves(host)}`);

// Walk up the domain to see where resolution starts failing. This tells us
// whether the whole cloud domain is gone or just this instance's record.
for (let i = 1; i < parts.length - 1; i += 1) {
  const parent = parts.slice(i).join(".");
  console.log(`resolve parent[-${parts.length - i}] ${maskHost(parent)}: ${await resolves(parent)}`);
}

console.log("\nInterpretation guide:");
console.log("  baseline OK + full host FAIL(ENOTFOUND) => instance DNS record is gone");
console.log("  (free-tier instances are stopped when idle and reclaimed later)");
