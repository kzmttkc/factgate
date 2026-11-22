// The read-only checks FactGate offers as actions, shared by the page (site-actions.js) and
// the action bridge that other agent sites call (bridge/bridge-actions.js). Each one only
// reads: GET, MCP initialize/tools/list, eth_call, vet402's read tool. None pays or signs.
import { CHAINS } from "./chain.mjs";
import { gateCheck, summarizeCheck } from "./gatecheck.mjs";
import { probeLive } from "./probe.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https, or http on loopback for local development (spec 3.3). */
export function validTarget(url) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return { ok: false, reason: "Give an absolute URL, such as https://agent402.tools/api/weather-forecast.", field: "url" };
  }
  if (u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname))) {
    return { ok: true, url: u.href };
  }
  return { ok: false, reason: "Use https (http only on localhost or 127.0.0.1).", field: "url" };
}

function badAgentId(args) {
  const id = args && args.agentId;
  if (id === undefined || id === null || id === "") {
    return null;
  }
  return /^[0-9]{1,78}$/.test(String(id)) ? null : { ok: false, reason: "agentId must be digits only.", field: "agentId" };
}

const URL_PROP = { type: "string", minLength: 8, maxLength: 2048, description: "Agent network URL, x402 endpoint or site address" };
const CHAIN_IDS = Object.keys(CHAINS).map(Number);

export const SCHEMAS = {
  target: { type: "object", additionalProperties: false, required: ["url"], properties: { url: URL_PROP } },
  gateCheck: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: {
      url: URL_PROP,
      agentId: { type: "string", maxLength: 78, description: "Only if the visitor named one" },
      chainId: { type: "integer", enum: CHAIN_IDS, description: "8453 Base, 84532 Base Sepolia, 42220 Celo" },
    },
  },
};

export const DESCRIPTIONS = {
  gate_check:
    "Full FactGate check of one URL, done by page code: manifest, MCP and x402 terms read over CORS; the declared ERC-8004 registration read on chain and compared with payTo; vet402's delivery record. Returns {verdict, reasons, live, identity, delivery}. Never pays. Report verdict and reasons as returned.",
  inspect_manifest:
    "What a counterparty declares: agent-manifest.json, network definition (front agent, MCP servers, peers) and ERC-8004 registration file, each with URL, HTTP status and problems.",
  probe_capabilities:
    "Whether a counterparty answers as declared: MCP tools/list, x402 terms (read, never paid), payTo vs its own declared wallets, empty paid answers. Unreachable means CORS or network, never worked around.",
  read_identity:
    "Pillar 2 only: the declared (or given) ERC-8004 agent read on chain with eth_call; owner and agentWallet compared with the 402 payTo. Declared but not on chain is never a match.",
};

function compactChecks(c) {
  const pick = (x) => (x ? { state: x.state, url: x.url, status: x.status, error: x.error, problems: x.problems, warnings: x.warnings } : null);
  return { manifest: pick(c.manifest), network: pick(c.network), registration: pick(c.registration) };
}

export async function gateCheckRead(args, fetchImpl) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const bad = badAgentId(args);
  if (bad) {
    return bad;
  }
  const result = await gateCheck({ url: t.url, agentId: args.agentId, chainId: args.chainId }, { fetch: fetchImpl });
  return { summary: summarizeCheck(result), result };
}

export async function inspectManifestRead(args, fetchImpl) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const live = await probeLive(t.url, { fetch: fetchImpl });
  return {
    ok: true,
    url: t.url,
    checks: compactChecks(live.checks),
    manifestEntry: live.declared.manifestEntry,
    network: live.declared.network,
    registration: live.declared.registrationFile ? { url: live.declared.registrationUrl, name: live.declared.registrationFile.name, registrations: live.declared.registrationFile.registrations } : null,
    http: live.http.map((h) => ({ method: h.method, url: h.url, status: h.status, error: h.error })),
  };
}

export async function probeCapabilitiesRead(args, fetchImpl) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const live = await probeLive(t.url, { fetch: fetchImpl });
  const c = live.checks;
  return {
    ok: true,
    url: t.url,
    live: live.pillar.data || live.pillar,
    mcp: (c.mcp || []).map((m) => ({ url: m.url, from: m.from, state: m.state, declaredTools: m.tools, missing: m.missing, listedCount: m.listed ? m.listed.length : undefined, error: m.error })),
    payment: c.payment || null,
    terms: live.declared.terms ? live.declared.terms.accepts.slice(0, 8) : null,
    wallets: c.wallets || null,
    resource: c.resource || null,
  };
}

export async function readIdentityRead(args, fetchImpl) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const bad = badAgentId(args);
  if (bad) {
    return bad;
  }
  const result = await gateCheck({ url: t.url, agentId: args.agentId, chainId: args.chainId }, { fetch: fetchImpl, skipDelivery: true });
  const s = summarizeCheck(result);
  return { ok: true, url: t.url, reason: result.reasons.find((r) => r.pillar === "identity"), identity: s.identity, payTos: result.evidence.identity.payTos };
}
