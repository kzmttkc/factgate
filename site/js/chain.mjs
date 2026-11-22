// Pillar 2, identity: read a counterparty's ERC-8004 registration on chain and compare it with
// the payee it declares in its 402 answer. Read-only: eth_call only, never a transaction.
//
// Sources (checked 2026-11-22):
// - Registry addresses: github.com/erc-8004/erc-8004-contracts README, "Base Mainnet",
//   "Base Sepolia" and "Celo Mainnet" (commit b9e466c2).
// - Functions: abis/IdentityRegistry.json in the same repo: ownerOf(uint256) -> address,
//   getAgentWallet(uint256) -> address, tokenURI(uint256) -> string. Selectors are checked
//   against Keccak-256 in test/chain.test.mjs.
// - Registration file and endpoint-domain verification: ERC8004SPEC.md in the same repo.
import { DEFAULT_TIMEOUT_MS, sameOrigin, timedFetch } from "./net.mjs";

export const IDENTITY_REGISTRY = Object.freeze({
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
});

export const CHAINS = Object.freeze({
  8453: Object.freeze({ name: "Base", rpc: "https://mainnet.base.org", rpcFallback: "https://base-rpc.publicnode.com", registry: IDENTITY_REGISTRY.mainnet }),
  84532: Object.freeze({ name: "Base Sepolia", rpc: "https://sepolia.base.org", rpcFallback: "https://base-sepolia-rpc.publicnode.com", registry: IDENTITY_REGISTRY.testnet }),
  42220: Object.freeze({ name: "Celo", rpc: "https://forno.celo.org", rpcFallback: "https://celo-rpc.publicnode.com", registry: IDENTITY_REGISTRY.mainnet }),
});

/** Public JSON-RPC URLs for one chain: primary, then fallback when the first fails or rate-limits. */
export function chainRpcUrls(chain) {
  const urls = [chain.rpc];
  if (chain.rpcFallback && chain.rpcFallback !== chain.rpc) {
    urls.push(chain.rpcFallback);
  }
  return urls;
}

/**
 * POST one JSON-RPC payload to the chain's RPC URLs in order.
 * Returns { ok, url?, json?, error?, attempts: [{ url, ok, error? }] }.
 */
export async function postChainRpc(fetchImpl, chain, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const attempts = [];
  for (const url of chainRpcUrls(chain)) {
    const got = await timedFetch(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, timeoutMs);
    if (!got.ok) {
      attempts.push({ url, ok: false, error: got.error });
      continue;
    }
    if (got.response.status === 429) {
      attempts.push({ url, ok: false, error: "RPC HTTP 429 (rate limited)" });
      continue;
    }
    if (got.response.status !== 200) {
      attempts.push({ url, ok: false, error: `RPC HTTP ${got.response.status}` });
      continue;
    }
    let json;
    try {
      json = await got.response.json();
    } catch {
      attempts.push({ url, ok: false, error: "RPC answer is not JSON" });
      continue;
    }
    attempts.push({ url, ok: true });
    return { ok: true, url, json, attempts };
  }
  const last = attempts[attempts.length - 1];
  return { ok: false, error: (last && last.error) || "no RPC answered", attempts };
}

export const SELECTORS = Object.freeze({
  ownerOf: "0x6352211e",
  getAgentWallet: "0x00339509",
  tokenURI: "0xc87b56dd",
});

// x402 v1 network names for the EVM chains above.
const V1_NETWORKS = { base: 8453, "base-sepolia": 84532, celo: 42220 };

const MAX_UINT256 = (1n << 256n) - 1n;

function toAgentId(id) {
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new Error(`agentId must be a non-negative integer, got ${id}`);
    }
    return BigInt(id);
  }
  if (typeof id === "string" && /^[0-9]{1,78}$/.test(id.trim())) {
    const v = BigInt(id.trim());
    if (v <= MAX_UINT256) {
      return v;
    }
  }
  if (typeof id === "bigint" && id >= 0n && id <= MAX_UINT256) {
    return id;
  }
  throw new Error(`agentId must be a non-negative integer, got ${String(id)}`);
}

/** selector + one uint256 argument, as eth_call data. */
export function encodeUintCall(sel, id) {
  return `${sel}${toAgentId(id).toString(16).padStart(64, "0")}`;
}

function normAddress(value) {
  if (typeof value !== "string") {
    return null;
  }
  const v = value.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(v) ? v : null;
}

export function isZeroAddress(a) {
  return typeof a === "string" && /^0x0{40}$/i.test(a);
}

/** Decode an ABI address result (one 32-byte word, upper 12 bytes zero). */
export function decodeAddress(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }
  const body = hex.slice(2).toLowerCase();
  if (!/^0{24}$/.test(body.slice(0, 24))) {
    return null;
  }
  return `0x${body.slice(24)}`;
}

/** Decode an ABI string result. Null for an empty or malformed result. */
export function decodeString(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 2 + 128) {
    return null;
  }
  const body = hex.slice(2);
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2;
  if (offset + 64 > body.length) {
    return null;
  }
  const len = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)) * 2;
  const start = offset + 64;
  if (start + len > body.length) {
    return null;
  }
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(body.slice(start + i * 2, start + i * 2 + 2), 16);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** "eip155:8453:0x…" -> { namespace, chainId, address }. Null for anything else. */
export function parseAgentRegistry(value) {
  if (typeof value !== "string") {
    return null;
  }
  const m = /^(eip155):([0-9]{1,12}):(0x[0-9a-fA-F]{40})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  return { namespace: m[1], chainId: Number(m[2]), address: m[3].toLowerCase() };
}

/**
 * From a registration file's "registrations", take the first entry on a chain FactGate reads
 * whose agentRegistry is the official IdentityRegistry. Entries in another registry go to
 * "unofficial" (shown, never judged); other entries it cannot read go to "skipped" with why.
 */
export function pickRegistration(file) {
  const out = { chosen: null, skipped: [], unofficial: [], declared: 0 };
  const list = file && Array.isArray(file.registrations) ? file.registrations : [];
  out.declared = list.length;
  for (const r of list) {
    const reg = parseAgentRegistry(r && r.agentRegistry);
    const label = `agentId ${r && r.agentId} at ${r && r.agentRegistry}`;
    if (!reg) {
      out.skipped.push(`${label}: agentRegistry is not eip155:<chainId>:<address>`);
      continue;
    }
    const chain = CHAINS[reg.chainId];
    if (!chain) {
      out.skipped.push(`${label}: chain ${reg.chainId} is not one FactGate reads`);
      continue;
    }
    if (reg.address !== chain.registry.toLowerCase()) {
      // Another registry (for example Self Agent ID on Celo): shown, never judged.
      out.unofficial.push({ agentId: r.agentId, agentRegistry: r.agentRegistry, note: `not the official ERC-8004 IdentityRegistry on ${chain.name} (${chain.registry}); shown only, not used in the verdict` });
      continue;
    }
    let agentId;
    try {
      agentId = toAgentId(r.agentId).toString();
    } catch {
      out.skipped.push(`${label}: agentId is not an integer`);
      continue;
    }
    if (!out.chosen) {
      out.chosen = { chainId: reg.chainId, agentId };
    }
  }
  return out;
}

/** A data: URI holding JSON (base64 or percent-encoded) -> object. Null otherwise. */
export function decodeDataUriJson(uri) {
  if (typeof uri !== "string" || !uri.startsWith("data:")) {
    return null;
  }
  const comma = uri.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  try {
    let text;
    if (/;base64$/i.test(meta)) {
      if (!/^[A-Za-z0-9+/=_-]*$/.test(payload)) {
        return null;
      }
      const bin = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else {
      text = decodeURIComponent(payload);
    }
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function chainOfNetwork(network) {
  if (typeof network !== "string") {
    return null;
  }
  const m = /^eip155:([0-9]{1,12})$/.exec(network);
  if (m) {
    return Number(m[1]);
  }
  return Object.hasOwn(V1_NETWORKS, network) ? V1_NETWORKS[network] : null;
}

/**
 * Split the 402 accepts into EVM payees (compared with ERC-8004) and the rest (Solana,
 * Stellar, …), which an EVM registry cannot speak for.
 */
export function evmPayTos(terms) {
  const out = { compared: [], notCompared: [] };
  const accepts = terms && Array.isArray(terms.accepts) ? terms.accepts : [];
  for (const a of accepts) {
    const payTo = normAddress(a && a.payTo);
    const chainId = chainOfNetwork(a && a.network);
    if (payTo && (chainId !== null || /^eip155:/.test(String(a.network)))) {
      out.compared.push({ network: a.network, chainId, payTo });
    } else {
      out.notCompared.push({ network: a && a.network, payTo: a && a.payTo });
    }
  }
  return out;
}

/**
 * Does this ERC-8004 agent claim the target URL? (ERC8004SPEC "Endpoint Domain Verification".)
 * Two directions are read separately:
 * - siteToAgent: the target origin's /.well-known/agent-registration.json lists the same agentId
 *   and registry (the site names the agent);
 * - agentToSite: the on-chain agentURI is on the target's origin or contains the target's URL, or
 *   the registration file the agentURI points to names a service endpoint on the target's origin
 *   (the agent names the site).
 * bound is either direction (used to decide whether the agent's records speak for this URL).
 * mutual is both directions (used for a counterparty that asks for no payment).
 */
export function bindingOf({ targetUrl, chainId, agentId, wellKnown, tokenURI, registrationFile }) {
  const chain = CHAINS[chainId];
  const how = [];
  let siteToAgent = false;
  let agentToSite = false;
  const regs = wellKnown && Array.isArray(wellKnown.registrations) ? wellKnown.registrations : [];
  for (const r of regs) {
    const reg = parseAgentRegistry(r && r.agentRegistry);
    if (reg && chain && reg.chainId === Number(chainId) && reg.address === chain.registry.toLowerCase() && String(r.agentId) === String(agentId)) {
      siteToAgent = true;
      how.push("the site's /.well-known/agent-registration.json lists this agentId and registry");
      break;
    }
  }
  let targetOrigin = null;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    targetOrigin = null;
  }
  if (typeof tokenURI === "string" && /^https?:/.test(tokenURI) && sameOrigin(tokenURI, targetUrl)) {
    agentToSite = true;
    how.push("the on-chain agentURI is on the site's origin");
  } else if (typeof tokenURI === "string" && targetOrigin && !tokenURI.startsWith("data:") && tokenURI.includes(targetOrigin)) {
    agentToSite = true;
    how.push("the on-chain agentURI contains the site's URL");
  }
  if (!agentToSite) {
    const services = registrationFile && Array.isArray(registrationFile.services) ? registrationFile.services : [];
    for (const s of services) {
      if (s && typeof s.endpoint === "string" && /^https?:/.test(s.endpoint) && sameOrigin(s.endpoint, targetUrl)) {
        agentToSite = true;
        how.push(`the registration file the agentURI points to names a ${s.name || "service"} endpoint on the site's origin`);
        break;
      }
    }
  }
  const bound = siteToAgent || agentToSite;
  return {
    bound,
    mutual: siteToAgent && agentToSite,
    siteToAgent,
    agentToSite,
    how: how.length ? how.join("; and ") : "nothing ties this agent to the target's origin",
  };
}

/**
 * Build pillar 2 from what was read.
 *
 * :param payTos: evmPayTos() of the 402 terms.
 * :param chainRead: readAgent() result, or null when no agent was looked up.
 * :param binding: bindingOf() result.
 * :param noAgentReason: why no agent was looked up (unavailable).
 * :param declaredOnlyReason: the site declares a registration that FactGate cannot find on chain.
 */
export function identityPillar({ payTos, chainRead, binding, noAgentReason, declaredOnlyReason }) {
  const declaredPayTos = (payTos && Array.isArray(payTos.compared) ? payTos.compared : []).map((p) => p.payTo);
  const unique = [...new Set(declaredPayTos)];
  const base = { declaredPayTo: unique[0] || null, declaredPayTos: unique };
  if (!chainRead) {
    if (declaredOnlyReason) {
      return { status: "ok", data: { ...base, registered: null, declaredOnly: true, declaredReason: declaredOnlyReason } };
    }
    return { status: "unavailable", error: noAgentReason || "no ERC-8004 agent to look up" };
  }
  if (!chainRead.ok) {
    return { status: "unavailable", error: chainRead.error || "registry read failed" };
  }
  if (!chainRead.exists) {
    return { status: "ok", data: { ...base, registered: null, declaredOnly: true, declaredReason: chainRead.notFoundReason || "the agentId does not exist on chain" } };
  }
  const wallet = chainRead.agentWallet && !isZeroAddress(chainRead.agentWallet) ? chainRead.agentWallet : null;
  return {
    status: "ok",
    data: {
      ...base,
      registered: {
        owner: chainRead.owner,
        agentWallet: wallet,
        payTo: null,
        bound: binding ? binding.bound : false,
        mutual: binding ? binding.mutual === true : false,
        how: binding ? binding.how : undefined,
        readAt: `eth_call at ${chainRead.chain || `chain ${chainRead.chainId}`} block ${chainRead.block ?? "latest"}, IdentityRegistry ${chainRead.registry}, agentId ${chainRead.agentId}`,
      },
    },
  };
}

async function ethCall(fetchImpl, chain, data, timeoutMs, blockTag = "latest", rpcOrder = null) {
  const urls = rpcOrder && rpcOrder.length ? rpcOrder : chainRpcUrls(chain);
  const attempts = [];
  for (const url of urls) {
    const got = await timedFetch(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: chain.registry, data }, blockTag] }) }, timeoutMs);
    if (!got.ok) {
      attempts.push({ url, ok: false, error: got.error });
      continue;
    }
    if (got.response.status === 429) {
      attempts.push({ url, ok: false, error: "RPC HTTP 429 (rate limited)" });
      continue;
    }
    if (got.response.status !== 200) {
      attempts.push({ url, ok: false, error: `RPC HTTP ${got.response.status}` });
      continue;
    }
    let json;
    try {
      json = await got.response.json();
    } catch {
      attempts.push({ url, ok: false, error: "RPC answer is not JSON" });
      continue;
    }
  if (json && json.error) {
      const reverted = json.error.code === 3 || /revert/i.test(String(json.error.message));
      attempts.push({ url, ok: true });
      return { ok: true, reverted, error: `${json.error.code}: ${json.error.message}`, rpcUrl: url, attempts };
    }
    if (!json || typeof json.result !== "string") {
      attempts.push({ url, ok: false, error: "RPC answer has no result" });
      continue;
    }
    attempts.push({ url, ok: true });
    return { ok: true, result: json.result, rpcUrl: url, attempts };
  }
  return { ok: false, error: (attempts[attempts.length - 1] && attempts[attempts.length - 1].error) || "no RPC answered", attempts };
}

/**
 * Read owner, agentWallet and agentURI of one agent with eth_call. Never sends a transaction.
 * Returns { ok, exists, owner, agentWallet, tokenURI, rpc[] } or { ok: false, error, rpc[] }.
 */
export async function readAgent({ chainId, agentId }, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const chain = CHAINS[Number(chainId)];
  if (!chain) {
    return { ok: false, error: `chain ${chainId} is not one FactGate reads (${Object.keys(CHAINS).join(", ")})`, rpc: [] };
  }
  let calls;
  try {
    calls = Object.entries(SELECTORS).map(([fn, sel]) => [fn, encodeUintCall(sel, agentId)]);
  } catch (error) {
    return { ok: false, error: error.message, rpc: [] };
  }
  // Pin every read to one block, so the evidence names where it was read.
  let blockTag = "latest";
  const head = await postChainRpc(fetchImpl, chain, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, timeoutMs);
  const rpcLog = (head.attempts || []).map((a) => ({ url: a.url, method: "eth_blockNumber", ok: a.ok, error: a.ok ? undefined : a.error }));
  let rpcOrder = chainRpcUrls(chain);
  if (head.ok && head.url) {
    rpcOrder = [head.url, ...rpcOrder.filter((u) => u !== head.url)];
    if (typeof head.json.result === "string" && /^0x[0-9a-f]+$/i.test(head.json.result)) {
      blockTag = head.json.result;
    }
  }
  const block = blockTag === "latest" ? null : parseInt(blockTag, 16);
  const answers = [];
  for (const [, data] of calls) {
    answers.push(await ethCall(fetchImpl, chain, data, timeoutMs, blockTag, rpcOrder));
  }
  const rpc = [...rpcLog];
  for (let i = 0; i < calls.length; i += 1) {
    const [fn, data] = calls[i];
    const answer = answers[i];
    const url = answer.rpcUrl || (answer.attempts && answer.attempts.find((a) => a.ok)?.url) || rpcOrder[0];
    rpc.push({ url, method: `eth_call ${fn}`, to: chain.registry, data, block: blockTag, ok: answer.ok, error: answer.ok ? undefined : answer.error, reverted: answer.reverted });
    for (const a of answer.attempts || []) {
      if (a.url !== url && !rpc.some((x) => x.url === a.url && x.method === `eth_call ${fn}`)) {
        rpc.push({ url: a.url, method: `eth_call ${fn}`, to: chain.registry, data, block: blockTag, ok: false, error: a.error });
      }
    }
  }
  const byFn = Object.fromEntries(calls.map(([fn], i) => [fn, answers[i]]));
  const owner = byFn.ownerOf;
  if (!owner.ok) {
    return { ok: false, error: `ownerOf: ${owner.error}`, rpc };
  }
  if (owner.reverted) {
    return { ok: true, exists: false, notFoundReason: `agentId ${agentId} does not exist on ${chain.name} (ownerOf reverted)`, rpc };
  }
  if (owner.result === "0x") {
    return { ok: false, error: `ownerOf returned an empty result: no contract answers at ${chain.registry} on ${chain.name}`, rpc };
  }
  const ownerAddr = decodeAddress(owner.result);
  if (!ownerAddr) {
    return { ok: false, error: `ownerOf result is not an address: ${owner.result.slice(0, 80)}`, rpc };
  }
  const walletAnswer = byFn.getAgentWallet;
  const wallet = walletAnswer.ok && walletAnswer.result ? decodeAddress(walletAnswer.result) : null;
  const uriAnswer = byFn.tokenURI;
  const tokenURI = uriAnswer.ok && uriAnswer.result ? decodeString(uriAnswer.result) : null;
  return { ok: true, exists: true, chainId: Number(chainId), chain: chain.name, agentId: String(agentId), registry: chain.registry, block, owner: ownerAddr, agentWallet: wallet, tokenURI, rpc };
}
