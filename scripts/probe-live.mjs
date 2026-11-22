// Measure real counterparties with the same gateCheck() the page runs, through a fetch that
// applies the browser's CORS rules for FactGate's page origin. Read-only: GET, MCP
// initialize/tools/list, eth_call, vet402's read tool. Writes evidence/live/.
//
// Usage:
//   node scripts/probe-live.mjs                 # the default public targets
//   node scripts/probe-live.mjs --peers         # also the local demo peers on 8791/8792
//   node scripts/probe-live.mjs <url> [<url>…]  # only these
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAINS, readAgent } from "../site/js/chain.mjs";
import { gateCheck, summarizeCheck } from "../site/js/gatecheck.mjs";
import { corsFetch } from "./cors-fetch.mjs";

const ORIGIN = "http://localhost:8790";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "evidence", "live");

// From docs/agentic_websites.md (cognizant-ai-labs/agentic-web, main, read 2026-11-22), plus
// vet402.com and one x402 seller vet402 has paid.
const DEFAULT_TARGETS = [
  "https://agent402.tools/api/weather-forecast",
  "https://agent-atlas-phi.vercel.app/agent_atlas",
  "https://deadline-desk-agent.vercel.app/deadline_desk",
  "https://ledenti.github.io/trois-nombres/three_numbers",
  "https://shutdown-clerk.pages.dev/shutdown_clerk",
  "https://cocvn157.github.io/nanda-seal/nanda_seal_verifier",
  "https://worldwideagenticweb.org/wp-content/plugins/wwaw-agent-widget/assets/worldwide_agentic_web_widget/v1.0.9/worldwide_agentic_web_widget",
  "https://vet402.com/",
];
const PEERS = ["http://127.0.0.1:8791/glossy_stay", "http://127.0.0.1:8792/verified_stay"];

// ERC-8004 agents read directly: the Base Sepolia ids from the brief and Base mainnet examples.
const AGENT_READS = [
  { chainId: 84532, agentId: "10798" },
  { chainId: 84532, agentId: "10799" },
  { chainId: 84532, agentId: "10801" },
  { chainId: 8453, agentId: "1" },
  { chainId: 8453, agentId: "94639" },
  { chainId: 42220, agentId: "9907" },
];

function slug(url) {
  return url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

async function main() {
  const args = process.argv.slice(2);
  const urls = args.filter((a) => !a.startsWith("--"));
  let targets = urls.length ? urls : DEFAULT_TARGETS;
  if (args.includes("--peers")) {
    targets = [...targets, ...PEERS];
  }
  await mkdir(OUT, { recursive: true });
  const fetchImpl = corsFetch({ origin: ORIGIN });
  const summary = { measuredAt: new Date().toISOString(), pageOrigin: ORIGIN, method: "gateCheck() with scripts/cors-fetch.mjs (browser CORS rules applied to real answers)", targets: [] };

  for (const url of targets) {
    const started = Date.now();
    const result = await gateCheck({ url }, { fetch: fetchImpl, timeoutMs: 15000 });
    const file = `${slug(url)}.json`;
    await writeFile(path.join(OUT, file), `${JSON.stringify({ ...result, pageOrigin: ORIGIN, ms: Date.now() - started }, null, 2)}\n`);
    const s = summarizeCheck(result);
    summary.targets.push({ file, url, verdict: s.verdict, codes: result.reasons.map((r) => `${r.effect}:${r.code}`), http: result.evidence.live.http.map((h) => `${h.method} ${h.url} -> ${h.status ?? h.error}`) });
    console.log(`${s.verdict.padEnd(7)} ${url}`);
    for (const r of result.reasons) {
      console.log(`         [${r.effect}] ${r.code}: ${r.text.slice(0, 220)}`);
    }
  }

  const reads = [];
  for (const a of AGENT_READS) {
    const r = await readAgent(a, fetchImpl, 15000);
    reads.push({ ...a, chain: CHAINS[a.chainId].name, registry: CHAINS[a.chainId].registry, ...r });
    console.log(`ERC-8004 ${CHAINS[a.chainId].name} #${a.agentId}: ${r.ok ? (r.exists ? `owner ${r.owner} agentWallet ${r.agentWallet} uri ${String(r.tokenURI).slice(0, 90)}` : "not found") : `ERROR ${r.error}`}`);
  }
  await writeFile(path.join(OUT, "erc8004_reads.json"), `${JSON.stringify({ measuredAt: summary.measuredAt, pageOrigin: ORIGIN, reads }, null, 2)}\n`);
  await writeFile(path.join(OUT, "SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

await main();
