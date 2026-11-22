// The read-only checks FactGate offers as actions, shared by the page (site-actions.js) and
// the action bridge that other agent sites call (bridge/bridge-actions.js). Each one only
// reads: GET, MCP initialize/tools/list, eth_call, vet402's read tool. None pays or signs.
// opts.ask is the visitor's consent card (js/consent.mjs): with it, no request goes to an origin
// the visitor has not approved. The page and the bridge window always pass it.
import { CHAINS } from "./chain.mjs";
import { withConsent } from "./consent.mjs";
import { gateCheck, summarizeCheck } from "./gatecheck.mjs";
import { lookupNanda } from "./nanda.mjs";
import { probeLive } from "./probe.mjs";

function hosts(consent) {
  return { approved: consent.approved.map((o) => new URL(o).host), declined: consent.declined.map((o) => new URL(o).host) };
}

async function probeWithConsent(url, fetchImpl, opts, { nanda = false, known = null } = {}) {
  const run = (f) => Promise.all([probeLive(url, { fetch: f }), nanda && !known ? lookupNanda(f, { url }) : Promise.resolve(known)]);
  if (typeof opts.ask !== "function") {
    const [live, found] = await run(fetchImpl);
    return { live, nanda: found, consent: undefined };
  }
  const { result, consent } = await withConsent(run, { fetch: fetchImpl, ask: opts.ask, remembered: opts.remembered });
  return { live: result[0], nanda: result[1], consent: hosts(consent) };
}

/**
 * The counterparty to check: args.url, or the URL of the NANDA Index record args.nanda names
 * (a urn:air: identifier, an orgId or a display name). Looking it up contacts api.nandaindex.org,
 * after the visitor's card when opts.ask is given.
 *
 * :return: { ok: true, url, nanda } or { ok: false, reason, field }.
 */
export async function resolveTarget(args, fetchImpl, opts = {}) {
  const a = args || {};
  if (a.url) {
    const t = validTarget(a.url);
    return t.ok ? { ...t, nanda: null } : t;
  }
  const id = typeof a.nanda === "string" ? a.nanda.trim() : "";
  if (!id) {
    return { ok: false, reason: "Give the counterparty's URL, or its NANDA Index id or name.", field: "url" };
  }
  let found;
  if (typeof opts.ask === "function") {
    const { result, consent } = await withConsent((f) => lookupNanda(f, { id }), { fetch: fetchImpl, ask: opts.ask, remembered: opts.remembered });
    found = result;
    if (consent.declined.length) {
      return { ok: false, reason: "You declined api.nandaindex.org, so the NANDA name was not looked up. Give the URL instead.", field: "nanda" };
    }
  } else {
    found = await lookupNanda(fetchImpl, { id });
  }
  if (found.status === "unavailable") {
    return { ok: false, reason: `The NANDA Index could not be read: ${found.error}.`, field: "nanda" };
  }
  if (found.status !== "listed") {
    return { ok: false, reason: `No NANDA Index record has the id, orgId or name "${id}" (${found.searched} records searched).`, field: "nanda" };
  }
  const t = validTarget(found.record.url);
  if (!t.ok) {
    return { ok: false, reason: `The NANDA record ${found.record.identifier} gives no https URL to check (${found.record.url || "none"}).`, field: "nanda" };
  }
  return { ...t, nanda: found };
}

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
const NANDA_PROP = { type: "string", minLength: 2, maxLength: 300, description: "Instead of url: a NANDA Index id (urn:air:...), orgId or name" };
const CHAIN_IDS = Object.keys(CHAINS).map(Number);

export const SCHEMAS = {
  target: { type: "object", additionalProperties: false, properties: { url: URL_PROP, nanda: NANDA_PROP } },
  gateCheck: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: URL_PROP,
      nanda: NANDA_PROP,
      agentId: { type: "string", maxLength: 78, description: "Only if the visitor named one" },
      chainId: { type: "integer", enum: CHAIN_IDS, description: "8453 Base, 84532 Base Sepolia, 42220 Celo" },
    },
  },
};

export const DESCRIPTIONS = {
  gate_check:
    "Full FactGate check of one URL by page code, after the visitor approves the origins it contacts: manifest, MCP and x402 terms over CORS; the declared ERC-8004 registration on chain vs payTo; vet402's delivery record. Returns {verdict, reasons, live, identity, delivery}. Never pays. Report verdict and reasons as returned.",
  inspect_manifest:
    "What a counterparty declares: agent-manifest.json, network definition (front agent, MCP servers, peers), ERC-8004 registration file, and its NANDA Index record if listed. Give url, or nanda (id or name).",
  probe_capabilities:
    "Whether a counterparty answers as declared: MCP tools/list, x402 terms (read, never paid), payTo vs its own declared wallets, empty paid answers. Unreachable means CORS or network, never worked around.",
  read_identity:
    "Pillar 2 only: the declared (or given) ERC-8004 agent read on chain with eth_call; owner and agentWallet compared with the 402 payTo. Declared but not on chain is never a match.",
};

function compactChecks(c) {
  const pick = (x) => (x ? { state: x.state, url: x.url, status: x.status, error: x.error, problems: x.problems, warnings: x.warnings } : null);
  return { manifest: pick(c.manifest), network: pick(c.network), registration: pick(c.registration) };
}

export async function gateCheckRead(args, fetchImpl, opts = {}) {
  const bad = badAgentId(args);
  if (bad) {
    return bad;
  }
  const t = await resolveTarget(args, fetchImpl, opts);
  if (!t.ok) {
    return t;
  }
  const result = await gateCheck({ url: t.url, agentId: args.agentId, chainId: args.chainId, nanda: t.nanda || undefined }, { fetch: fetchImpl, ask: opts.ask, remembered: opts.remembered, trustedValidators: opts.trustedValidators, skipNanda: opts.skipNanda });
  return { summary: summarizeCheck(result), result };
}

export async function inspectManifestRead(args, fetchImpl, opts = {}) {
  const t = await resolveTarget(args, fetchImpl, opts);
  if (!t.ok) {
    return t;
  }
  const { live, nanda, consent } = await probeWithConsent(t.url, fetchImpl, opts, { nanda: !opts.skipNanda, known: t.nanda });
  return {
    ok: true,
    url: t.url,
    consent,
    nanda: nanda ? (nanda.status === "listed" ? { status: "listed", line: nanda.record.line, record: nanda.record } : { status: nanda.status, error: nanda.error, searched: nanda.searched }) : null,
    checks: compactChecks(live.checks),
    manifestEntry: live.declared.manifestEntry,
    network: live.declared.network,
    registration: live.declared.registrationFile ? { url: live.declared.registrationUrl, name: live.declared.registrationFile.name, registrations: live.declared.registrationFile.registrations } : null,
    instructions: live.checks.instructions || null,
    http: live.http.map((h) => ({ method: h.method, url: h.url, status: h.status, error: h.error })),
  };
}

export async function probeCapabilitiesRead(args, fetchImpl, opts = {}) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const { live, consent } = await probeWithConsent(t.url, fetchImpl, opts);
  const c = live.checks;
  return {
    ok: true,
    url: t.url,
    consent,
    live: live.pillar.data || live.pillar,
    mcp: (c.mcp || []).map((m) => ({ url: m.url, from: m.from, state: m.state, declaredTools: m.tools, missing: m.missing, listedCount: m.listed ? m.listed.length : undefined, error: m.error })),
    payment: c.payment || null,
    terms: live.declared.terms ? live.declared.terms.accepts.slice(0, 8) : null,
    wallets: c.wallets || null,
    resource: c.resource || null,
  };
}

export async function readIdentityRead(args, fetchImpl, opts = {}) {
  const t = validTarget(args && args.url);
  if (!t.ok) {
    return t;
  }
  const bad = badAgentId(args);
  if (bad) {
    return bad;
  }
  const result = await gateCheck({ url: t.url, agentId: args.agentId, chainId: args.chainId }, { fetch: fetchImpl, skipDelivery: true, ask: opts.ask, remembered: opts.remembered, trustedValidators: opts.trustedValidators });
  const s = summarizeCheck(result);
  return { ok: true, url: t.url, reason: result.reasons.find((r) => r.pillar === "identity"), identity: s.identity, payTos: result.evidence.identity.payTos };
}
