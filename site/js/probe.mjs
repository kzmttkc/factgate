// Pillar 1, live probe: read what a counterparty declares (agent-manifest.json, the network
// definition, its ERC-8004 registration file, its MCP servers, its x402 terms) and check that
// it answers that way, from the browser, over CORS. It never pays and never works around CORS:
// a counterparty the browser cannot read is recorded as unreachable.
//
// The functions above probeLive() are pure and tested in test/probe.test.mjs.
import { evmPayTos } from "./chain.mjs";
import { scanInstructions } from "./instructions.mjs";
import { DEFAULT_TIMEOUT_MS, parseJson, readText, timedFetch } from "./net.mjs";

const MAX_MCP = 5;

function isHttpUrl(u) {
  return u instanceof URL && (u.protocol === "https:" || u.protocol === "http:");
}

/**
 * Spec 3.2: a network URL's last path part is the network name and the rest is the site base,
 * which holds agent-manifest.json. "<name>.network.json" names the network file itself.
 */
export function networkRef(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isHttpUrl(u)) {
    return null;
  }
  const parts = u.pathname.split("/");
  const last = parts.pop();
  const base = `${u.origin}${parts.join("/")}/`;
  let name = last || null;
  if (name && name.endsWith(".network.json")) {
    name = name.slice(0, -".network.json".length);
  }
  return { base, name, manifestUrl: `${base}agent-manifest.json` };
}

function str(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Check the manifest fields spec 3.3 requires and pick the requested network by exact name.
 * Without a name, a manifest with one network gives that one.
 */
export function inspectManifest(manifest, name) {
  const out = { ok: false, problems: [], warnings: [], entry: null };
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    out.problems.push("agent-manifest.json is not a JSON object");
    return out;
  }
  const networks = Array.isArray(manifest.networks) ? manifest.networks : [];
  if (networks.length === 0) {
    out.problems.push("agent-manifest.json lists no networks");
    return out;
  }
  let entry = null;
  if (name) {
    entry = networks.find((n) => n && n.name === name) || null;
    if (!entry) {
      out.problems.push(`agent-manifest.json has no network named "${name}" (spec 3.2: must fail, not pick another)`);
      return out;
    }
  } else {
    entry = networks[0];
    if (networks.length > 1) {
      out.warnings.push(`no network name in the URL; took the first of ${networks.length}`);
    }
  }
  out.entry = entry;
  for (const field of ["name", "front_man", "hocon"]) {
    if (!str(entry[field])) {
      out.problems.push(`network entry has no ${field}`);
    }
  }
  if (!Array.isArray(entry.sample_queries) || entry.sample_queries.length === 0) {
    out.warnings.push("network entry has no sample_queries");
  }
  if (!manifest.llm_router || typeof manifest.llm_router !== "object") {
    out.warnings.push("manifest has no llm_router metadata (spec 3.3)");
  }
  if (!manifest.peer_policy || typeof manifest.peer_policy !== "object") {
    out.warnings.push("manifest has no peer_policy (spec 3.3)");
  }
  out.ok = out.problems.length === 0;
  return out;
}

/**
 * Check a network definition (spec 2.1, 3.1 "Parse and validate") and collect what it declares
 * it will call: MCP servers with their tool names, and peer networks.
 */
export function inspectNetwork(network, frontMan) {
  const out = { ok: false, problems: [], warnings: [], agents: 0, mcp: [], peers: [], links: [], sampleQueries: 0 };
  const agents = network && Array.isArray(network.tools) ? network.tools : null;
  if (!agents || agents.length === 0) {
    out.problems.push("network definition has no agents (tools)");
    return out;
  }
  out.agents = agents.length;
  const names = new Set();
  for (const a of agents) {
    if (!a || !str(a.name)) {
      out.problems.push("an agent has no name");
      continue;
    }
    if (names.has(a.name)) {
      out.problems.push(`duplicate agent name "${a.name}"`);
    }
    names.add(a.name);
  }
  if (frontMan && !names.has(frontMan)) {
    out.problems.push(`front agent "${frontMan}" is not in the network`);
  }
  // A name in link_slots is a named peer-network reference that the site's links.json binds to
  // a URL (spec 3.3, "peer-network link map"); the runtime resolves it, so it is not an error.
  const slots = network.link_slots && typeof network.link_slots === "object" ? Object.keys(network.link_slots) : [];
  out.links = slots;
  for (const a of agents) {
    for (const t of Array.isArray(a && a.tools) ? a.tools : []) {
      if (typeof t === "string") {
        if (/^https?:\/\//.test(t)) {
          out.peers.push(t);
        } else if (slots.includes(t) && !names.has(t)) {
          if (!out.peers.includes(`link:${t}`)) {
            out.peers.push(`link:${t}`);
          }
        } else if (!names.has(t)) {
          out.problems.push(`agent "${a.name}" calls "${t}", which is not an agent in the network`);
        }
      } else if (t && typeof t === "object" && str(t.url)) {
        out.mcp.push({ url: t.url, tools: Array.isArray(t.tools) ? t.tools.filter(str) : [] });
      }
    }
  }
  const sq = network.metadata && Array.isArray(network.metadata.sample_queries) ? network.metadata.sample_queries : [];
  out.sampleQueries = sq.length;
  out.ok = out.problems.length === 0;
  return out;
}

function decodeBase64Json(text) {
  if (!str(text)) {
    return null;
  }
  try {
    const bin = atob(text.trim().replace(/-/g, "+").replace(/_/g, "/"));
    return parseJson(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

function normalizeTerms(obj) {
  const problems = [];
  const accepts = obj && Array.isArray(obj.accepts) ? obj.accepts : [];
  if (accepts.length === 0) {
    problems.push("the payment answer has no accepts[]");
  }
  const list = accepts.map((a, i) => {
    const e = {
      scheme: a && a.scheme,
      network: a && a.network,
      amount: a && (a.amount !== undefined ? String(a.amount) : a.maxAmountRequired !== undefined ? String(a.maxAmountRequired) : undefined),
      asset: a && a.asset,
      payTo: a && a.payTo,
    };
    for (const f of ["payTo", "network", "amount"]) {
      if (!str(e[f])) {
        problems.push(`accepts[${i}] has no ${f}`);
      }
    }
    return e;
  });
  const resourceUrl = obj && obj.resource && typeof obj.resource === "object" ? obj.resource.url : obj && typeof obj.resource === "string" ? obj.resource : undefined;
  return { ok: problems.length === 0, problems, terms: { x402Version: obj && obj.x402Version, resourceUrl, accepts: list } };
}

/**
 * Read x402 terms from a 402 answer: v2 puts them base64 in the PAYMENT-REQUIRED header,
 * v1 in the JSON body. Null when the status is not 402.
 */
export function parsePaymentRequired({ status, header, bodyText }) {
  if (status !== 402) {
    return null;
  }
  const fromHeader = decodeBase64Json(header);
  if (fromHeader && Array.isArray(fromHeader.accepts)) {
    return { ...normalizeTerms(fromHeader), source: "header" };
  }
  const body = parseJson(bodyText || "");
  if (body && typeof body === "object") {
    return { ...normalizeTerms(body), source: "body" };
  }
  return { ok: false, problems: ["402 without readable x402 terms (no PAYMENT-REQUIRED header the page can read, no JSON body)"], terms: null, source: null };
}

/** A declared quote file that stands in for a 402 (a static host cannot send 402). */
export function parseDeclaredQuote(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.accepts)) {
    return { ok: false, problems: ["the declared quote has no accepts[]"], terms: null, simulated: true };
  }
  return { ...normalizeTerms(json), source: "declared-quote", simulated: json.simulatedHttpStatus === 402 };
}

/** Parse a JSON-RPC answer sent as JSON or as server-sent events. */
export function parseRpcBody(text) {
  if (typeof text !== "string") {
    return null;
  }
  const direct = parseJson(text);
  if (direct && typeof direct === "object") {
    return direct;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  for (const l of lines.reverse()) {
    const j = parseJson(l.slice(5).trim());
    if (j && typeof j === "object" && (j.result || j.error)) {
      return j;
    }
  }
  return null;
}

/** Compare a tools/list answer with the tool names the network declares. */
export function checkToolsList(rpc, declared) {
  if (!rpc || typeof rpc !== "object") {
    return { ok: false, listed: [], missing: [], error: "no JSON-RPC answer" };
  }
  if (rpc.error) {
    return { ok: false, listed: [], missing: [], error: `JSON-RPC error ${rpc.error.code}: ${rpc.error.message}` };
  }
  const tools = rpc.result && Array.isArray(rpc.result.tools) ? rpc.result.tools : null;
  if (!tools) {
    return { ok: false, listed: [], missing: [], error: "tools/list answer has no result.tools" };
  }
  const listed = tools.map((t) => t && t.name).filter(str);
  const missing = (declared || []).filter((n) => !listed.includes(n));
  return { ok: missing.length === 0, listed, missing };
}

function addressFrom(value) {
  if (typeof value !== "string") {
    return null;
  }
  const v = value.trim();
  const m = /^eip155:[0-9]{1,12}:(0x[0-9a-fA-F]{40})$/.exec(v);
  const a = m ? m[1] : /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
  return a ? a.toLowerCase() : null;
}

/**
 * Resolve a manifest "trust" block (a FactGate-readable extension some sites publish) against
 * the site base: payment quote, paid resource, registration file, MCP, declared wallet.
 */
export function declaredTrust(manifest, base) {
  const out = { quoteUrl: null, resourceUrl: null, registrationUrl: null, mcp: [], wallets: [] };
  const t = manifest && manifest.trust && typeof manifest.trust === "object" ? manifest.trust : null;
  if (!t) {
    return out;
  }
  const resolve = (v) => {
    try {
      return str(v) ? new URL(v, base).href : null;
    } catch {
      return null;
    }
  };
  out.quoteUrl = resolve(t.payments && t.payments.quote);
  out.resourceUrl = resolve(t.payments && t.payments.resource);
  out.registrationUrl = resolve(t.identity && t.identity.registration);
  const mcps = Array.isArray(t.mcp) ? t.mcp : t.mcp ? [t.mcp] : [];
  out.mcp = mcps.filter((m) => m && str(m.url)).map((m) => ({ url: m.url, tools: Array.isArray(m.tools) ? m.tools.filter(str) : [] }));
  const w = addressFrom(t.identity && t.identity.agentWallet);
  if (w) {
    out.wallets.push(w);
  }
  return out;
}

/** Wallets a registration file names: "agentWallet" and services named like "wallet". */
export function declaredWallets(file) {
  if (!file || typeof file !== "object") {
    return [];
  }
  const out = [];
  const add = (a) => {
    if (a && !out.includes(a)) {
      out.push(a);
    }
  };
  add(addressFrom(file.agentWallet));
  for (const s of Array.isArray(file.services) ? file.services : []) {
    if (s && /wallet/i.test(String(s.name))) {
      add(addressFrom(s.endpoint));
    }
  }
  return out;
}

/** Does every EVM payTo in the terms belong to the wallets the site itself declares? */
export function compareDeclaredWallets(wallets, terms) {
  const payTos = evmPayTos(terms).compared.map((p) => p.payTo);
  if (!wallets || wallets.length === 0 || payTos.length === 0) {
    return { state: "not_compared", detail: wallets && wallets.length ? "no EVM payTo to compare" : "the site declares no wallet" };
  }
  const strangers = [...new Set(payTos.filter((p) => !wallets.includes(p)))];
  if (strangers.length > 0) {
    return { state: "mismatch", detail: `402 payTo ${strangers.join(", ")} is not among the wallets the site declares (${wallets.join(", ")})` };
  }
  return { state: "match", detail: `402 payTo is a declared wallet (${[...new Set(payTos)].join(", ")})` };
}

/** What the declared paid resource answers without payment: a 402, or a body. Empty is a mismatch. */
export function resourceCheck({ status, bodyText }) {
  if (status === 402) {
    return { state: "ok", detail: "asks for payment (402)" };
  }
  if (status >= 200 && status < 300) {
    return String(bodyText || "").trim() === "" ? { state: "empty", detail: `HTTP ${status} with an empty body` } : { state: "ok", detail: `HTTP ${status} with a body` };
  }
  return { state: "error", detail: `HTTP ${status}` };
}

/**
 * Combine the checks into pillar 1.
 * corsReachable: the browser could read at least one answer from the counterparty.
 * answersAsDeclared: false on any mismatch, true when at least one declaration was compared
 * and all matched, null when nothing was compared. Declared capabilities the browser cannot
 * reach are listed in "unreachable", never counted as a mismatch.
 */
export function liveFromChecks(checks) {
  const c = checks && typeof checks === "object" ? checks : {};
  const pillar = liveFromChecksBase(c);
  if (pillar.data && c.instructions && Array.isArray(c.instructions.findings)) {
    pillar.data.instructionFindings = c.instructions.findings;
  }
  return pillar;
}

function liveFromChecksBase(c) {
  const readable = (x) => x && (x.state === "found" || x.state === "absent");
  const reachable = Boolean((c.target && c.target.reachable) || readable(c.manifest) || readable(c.registration));
  if (!reachable) {
    const why = (c.target && c.target.error) || (c.manifest && c.manifest.error) || "no answer";
    const host = /visitor declined (.+)/i.exec(String(why));
    if (host) {
      const who = host[1].replace(/[.;,\s]+$/, "");
      return { status: "unavailable", error: `TypeError: not contacted: the visitor declined ${who}` };
    }
    return { status: "ok", data: { corsReachable: false, answersAsDeclared: null, detail: `the browser could not read the counterparty: ${why}`, unreachable: [] } };
  }
  const mismatch = [];
  const unreachable = [];
  const matched = [];
  if (c.manifest && c.manifest.state === "found") {
    (c.manifest.problems || []).forEach((p) => mismatch.push(`manifest: ${p}`));
    if (!(c.manifest.problems || []).length) {
      matched.push("manifest");
    }
  }
  if (c.network) {
    if (c.network.state === "found") {
      (c.network.problems || []).forEach((p) => mismatch.push(`network: ${p}`));
      if (!(c.network.problems || []).length) {
        matched.push("network");
      }
    } else if (c.network.state === "unreachable") {
      unreachable.push(`network definition ${c.network.url}: ${c.network.error}`);
    } else if (c.network.state === "error") {
      mismatch.push(`network definition ${c.network.url}: ${c.network.error}`);
    }
  }
  for (const m of Array.isArray(c.mcp) ? c.mcp : []) {
    if (m.state === "unreachable") {
      unreachable.push(`MCP ${m.url}: ${m.error}`);
    } else if (m.state === "error") {
      mismatch.push(`MCP ${m.url}: ${m.error}`);
    } else if (m.state === "ok") {
      if (m.missing && m.missing.length) {
        mismatch.push(`MCP ${m.url} does not list declared tools ${m.missing.join(", ")}`);
      } else {
        matched.push(`MCP ${m.url}`);
      }
    }
  }
  if (c.payment) {
    if (c.payment.state === "unreadable") {
      mismatch.push(`payment: ${(c.payment.problems || []).join("; ")}`);
    } else if (c.payment.state === "terms") {
      matched.push("x402 terms");
    } else if (c.payment.state === "unreachable") {
      unreachable.push(`payment quote ${c.payment.url}: ${c.payment.error}`);
    }
  }
  if (c.wallets) {
    if (c.wallets.state === "mismatch") {
      mismatch.push(c.wallets.detail);
    } else if (c.wallets.state === "match") {
      matched.push("declared wallet");
    }
  }
  if (c.resource) {
    if (c.resource.state === "empty" || c.resource.state === "error") {
      mismatch.push(`paid resource ${c.resource.url} answers ${c.resource.state === "empty" ? "with an empty body" : `HTTP ${c.resource.status}`}`);
    } else if (c.resource.state === "unreachable") {
      unreachable.push(`paid resource ${c.resource.url}: ${c.resource.error}`);
    } else if (c.resource.state === "ok") {
      matched.push("paid resource");
    }
  }
  if (mismatch.length) {
    return { status: "ok", data: { corsReachable: true, answersAsDeclared: false, detail: mismatch.join("; "), unreachable } };
  }
  if (matched.length) {
    return { status: "ok", data: { corsReachable: true, answersAsDeclared: true, detail: `as declared: ${matched.join(", ")}`, unreachable } };
  }
  return { status: "ok", data: { corsReachable: true, answersAsDeclared: null, detail: unreachable.length ? "nothing declared could be compared" : "nothing declared to compare", unreachable } };
}

// ---------------------------------------------------------------------------------------
// Network part. fetchImpl is window.fetch in the page, scripts/cors-fetch.mjs in Node.

function logEntry(http, url, method, got, extra = {}) {
  const e = { url, method, ...extra };
  if (got.ok) {
    e.status = got.response.status;
    e.contentType = got.response.headers.get("content-type");
  } else {
    e.error = got.error;
  }
  http.push(e);
  return e;
}

async function getJson(fetchImpl, http, url, timeoutMs) {
  const got = await timedFetch(fetchImpl, url, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
  const entry = logEntry(http, url, "GET", got);
  if (!got.ok) {
    return { state: "unreachable", error: got.error, url };
  }
  const text = await readText(got.response);
  entry.bytes = text.length;
  if (got.response.status !== 200) {
    return { state: "absent", status: got.response.status, url };
  }
  const json = parseJson(text);
  if (!json || typeof json !== "object") {
    return { state: "absent", status: 200, url, note: "not JSON" };
  }
  return { state: "found", status: 200, url, json };
}

async function rpcPost(fetchImpl, http, url, body, session, protocol, timeoutMs) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol };
  if (session) {
    headers["Mcp-Session-Id"] = session;
  }
  const got = await timedFetch(fetchImpl, url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  const entry = logEntry(http, url, `POST ${body.method}`, got);
  if (!got.ok) {
    return { ok: false, error: got.error };
  }
  const text = await readText(got.response);
  entry.bytes = text.length;
  return { ok: true, status: got.response.status, session: got.response.headers.get("mcp-session-id"), rpc: parseRpcBody(text) };
}

/** initialize, then tools/list, against one declared MCP server. Read-only. */
export async function probeMcp(fetchImpl, http, mcp, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const protocol = "2025-06-18";
  const init = await rpcPost(fetchImpl, http, mcp.url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "factgate", version: "0.2" } } }, null, protocol, timeoutMs);
  if (!init.ok) {
    return { url: mcp.url, tools: mcp.tools, state: "unreachable", error: init.error };
  }
  if (init.status !== 200 || !init.rpc || init.rpc.error) {
    return { url: mcp.url, tools: mcp.tools, state: "error", error: init.rpc && init.rpc.error ? `initialize: ${init.rpc.error.message}` : `initialize: HTTP ${init.status}` };
  }
  const version = (init.rpc.result && init.rpc.result.protocolVersion) || protocol;
  if (init.session) {
    await rpcPost(fetchImpl, http, mcp.url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session, version, timeoutMs);
  }
  const list = await rpcPost(fetchImpl, http, mcp.url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, init.session, version, timeoutMs);
  if (!list.ok) {
    return { url: mcp.url, tools: mcp.tools, state: "unreachable", error: list.error };
  }
  const r = checkToolsList(list.rpc, mcp.tools);
  if (r.error) {
    return { url: mcp.url, tools: mcp.tools, state: "error", error: `tools/list: ${r.error} (HTTP ${list.status})` };
  }
  return { url: mcp.url, tools: mcp.tools, state: "ok", listed: r.listed, missing: r.missing, session: Boolean(init.session) };
}

function mergeMcp(list) {
  const byUrl = new Map();
  for (const m of list) {
    const cur = byUrl.get(m.url) || { url: m.url, tools: [], from: [] };
    for (const t of m.tools || []) {
      if (!cur.tools.includes(t)) {
        cur.tools.push(t);
      }
    }
    if (m.from && !cur.from.includes(m.from)) {
      cur.from.push(m.from);
    }
    byUrl.set(m.url, cur);
  }
  return [...byUrl.values()];
}

/**
 * Probe one counterparty URL. Returns { pillar, checks, declared, http }.
 */
export async function probeLive(url, { fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const http = [];
  const ref = networkRef(url);
  if (!ref) {
    return { pillar: { status: "unavailable", error: "not an http(s) URL" }, checks: {}, declared: {}, http };
  }
  const origin = new URL(url).origin;
  const wellKnownUrl = `${origin}/.well-known/agent-registration.json`;

  const [targetGot, manifestRes, wellKnownRes] = await Promise.all([
    timedFetch(fetchImpl, url, { method: "GET", headers: { Accept: "application/json, text/html;q=0.5" } }, timeoutMs),
    getJson(fetchImpl, http, ref.manifestUrl, timeoutMs),
    getJson(fetchImpl, http, wellKnownUrl, timeoutMs),
  ]);
  const targetEntry = logEntry(http, url, "GET", targetGot);
  const checks = { target: { reachable: targetGot.ok, status: targetGot.ok ? targetGot.response.status : undefined, error: targetGot.ok ? undefined : targetGot.error } };
  const declared = { manifestEntry: null, network: null, mcp: [], terms: null, termsSource: null, registrationFile: null, registrationUrl: null, trust: null };

  // x402 terms from a real 402 answer.
  if (targetGot.ok) {
    const body = await readText(targetGot.response);
    targetEntry.bytes = body.length;
    const header = targetGot.response.headers.get("payment-required");
    targetEntry.paymentRequiredHeader = header ? "readable" : targetGot.response.status === 402 ? "not readable (missing or not exposed)" : undefined;
    const p = parsePaymentRequired({ status: targetGot.response.status, header, bodyText: body });
    if (p) {
      checks.payment = p.ok ? { state: "terms", source: p.source } : { state: "unreadable", problems: p.problems };
      declared.terms = p.terms;
      declared.termsSource = p.source;
    }
  }

  // Manifest and network definition.
  checks.manifest = { state: manifestRes.state, url: ref.manifestUrl, error: manifestRes.error, status: manifestRes.status };
  const mcpDeclared = [];
  let trust = null;
  if (manifestRes.state === "found") {
    const m = inspectManifest(manifestRes.json, ref.name);
    checks.manifest.problems = m.problems;
    checks.manifest.warnings = m.warnings;
    declared.manifestEntry = m.entry ? { name: m.entry.name, front_man: m.entry.front_man, hocon: m.entry.hocon, description: m.entry.description, sample_queries: m.entry.sample_queries } : null;
    trust = declaredTrust(manifestRes.json, ref.base);
    declared.trust = trust;
    trust.mcp.forEach((x) => mcpDeclared.push({ ...x, from: "manifest trust.mcp" }));
    const am = manifestRes.json.agent_mcp;
    if (am && am.available === true && str(am.url)) {
      mcpDeclared.push({ url: am.url, tools: [], from: "manifest agent_mcp" });
    }
    if (m.entry && str(m.entry.hocon)) {
      let netUrl = null;
      try {
        netUrl = new URL(m.entry.hocon, ref.base).href;
      } catch {
        checks.network = { state: "error", url: m.entry.hocon, error: "hocon is not a URL" };
      }
      if (netUrl) {
        const n = await getJson(fetchImpl, http, netUrl, timeoutMs);
        if (n.state === "found") {
          const ni = inspectNetwork(n.json, m.entry.front_man);
          checks.network = { state: "found", url: netUrl, problems: ni.problems, warnings: ni.warnings };
          declared.network = { agents: ni.agents, mcp: ni.mcp, peers: ni.peers, sampleQueries: ni.sampleQueries };
          const scan = scanInstructions(n.json, { siteUrl: url, declaredUrls: [...ni.peers.filter((x) => /^https?:/.test(x)), ...ni.mcp.map((x) => x.url)] });
          checks.instructions = { state: "scanned", url: netUrl, scanned: scan.scanned, findings: scan.findings };
          ni.mcp.forEach((x) => mcpDeclared.push({ ...x, from: "network definition" }));
        } else if (n.state === "unreachable") {
          checks.network = { state: "unreachable", url: netUrl, error: n.error };
        } else {
          checks.network = { state: "error", url: netUrl, error: `HTTP ${n.status}${n.note ? `, ${n.note}` : ""}` };
        }
      }
    }
  }

  // ERC-8004 registration file: the manifest's declared one, else the origin's well-known file.
  let reg = wellKnownRes;
  if (trust && trust.registrationUrl && trust.registrationUrl !== wellKnownUrl) {
    reg = await getJson(fetchImpl, http, trust.registrationUrl, timeoutMs);
  }
  checks.registration = { state: reg.state, url: reg.url, error: reg.error, status: reg.status };
  if (reg.state === "found") {
    declared.registrationFile = reg.json;
    declared.registrationUrl = reg.url;
    for (const s of Array.isArray(reg.json.services) ? reg.json.services : []) {
      if (s && /^mcp$/i.test(String(s.name)) && str(s.endpoint) && /^https?:\/\//.test(s.endpoint)) {
        mcpDeclared.push({ url: s.endpoint, tools: [], from: "registration services" });
      }
    }
  }

  // x402 terms from a declared quote, when the target itself did not answer 402.
  if (!declared.terms && trust && trust.quoteUrl) {
    const q = await getJson(fetchImpl, http, trust.quoteUrl, timeoutMs);
    if (q.state === "found") {
      const p = parseDeclaredQuote(q.json);
      checks.payment = p.ok ? { state: "terms", source: p.simulated ? "declared quote (simulated 402)" : "declared quote", url: trust.quoteUrl } : { state: "unreadable", problems: p.problems, url: trust.quoteUrl };
      declared.terms = p.terms;
      declared.termsSource = checks.payment.source;
    } else if (q.state === "unreachable") {
      checks.payment = { state: "unreachable", url: trust.quoteUrl, error: q.error };
    } else {
      checks.payment = { state: "unreadable", url: trust.quoteUrl, problems: [`declared quote answers HTTP ${q.status}`] };
    }
  }

  // The site's own wallets against its payTo.
  const wallets = [...new Set([...(trust ? trust.wallets : []), ...declaredWallets(declared.registrationFile)])];
  checks.wallets = { ...compareDeclaredWallets(wallets, declared.terms), wallets };

  // The declared paid resource must not answer an empty body.
  if (trust && trust.resourceUrl) {
    const got = await timedFetch(fetchImpl, trust.resourceUrl, { method: "GET" }, timeoutMs);
    const entry = logEntry(http, trust.resourceUrl, "GET", got);
    if (got.ok) {
      const body = await readText(got.response);
      entry.bytes = body.length;
      checks.resource = { ...resourceCheck({ status: got.response.status, bodyText: body }), url: trust.resourceUrl, status: got.response.status, bytes: body.length };
    } else {
      checks.resource = { state: "unreachable", url: trust.resourceUrl, error: got.error };
    }
  }

  // Declared MCP servers: tools/list.
  const mcps = mergeMcp(mcpDeclared).slice(0, MAX_MCP);
  checks.mcp = await Promise.all(mcps.map((m) => probeMcp(fetchImpl, http, m, timeoutMs).then((r) => ({ ...r, from: m.from }))));
  declared.mcp = checks.mcp.map((m) => ({ url: m.url, tools: m.tools, listed: m.listed || [], state: m.state }));

  return { pillar: liveFromChecks(checks), checks, declared, http };
}
