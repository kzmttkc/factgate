// Pillar 3, second source: scores that validators wrote for an agent in the ERC-8004
// ValidationRegistry (validationResponse, 0..100). Read-only: eth_call and eth_getLogs.
//
// Sources (checked 2026-11-22):
// - Addresses: github.com/erc-8004/erc-8004-contracts scripts/addresses.ts, TESTNET_ADDRESSES and
//   MAINNET_ADDRESSES .validationRegistry (bytecode present on Base, Base Sepolia and Celo).
// - Functions and event: abis/ValidationRegistry.json; behaviour: contracts/ValidationRegistryUpgradeable.sol.
//   getValidationStatus does not return hasResponse, and a request that was never answered reads as
//   response 0 with lastUpdate = request time. So a 0 is resolved from the logs at lastUpdate: a
//   ValidationResponse event there means "answered 0", a ValidationRequest event means "pending".
// Rule (executive decision 2026-11-22): at least one answered score >= 70 and none below 70 is a
// pass; any answered score below 70 is BLOCK. Self-validation (validator = the agent's owner or
// agentWallet) is shown but not counted. Only validators on the trusted list (js/validators.mjs,
// site/validators.json, changeable by the visitor) are counted; any other validator's scores are
// shown with the reason, never counted.
import { chainRpcUrls, postChainRpc } from "./chain.mjs";
import { DEFAULT_TIMEOUT_MS, timedFetch } from "./net.mjs";
import { DEFAULT_VALIDATORS, trustedRow } from "./validators.mjs";

export const VALIDATION_REGISTRY = Object.freeze({
  mainnet: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
  testnet: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
});

export const VALIDATION_CHAINS = Object.freeze({
  8453: Object.freeze({ rpc: "https://mainnet.base.org", rpcFallback: "https://base-rpc.publicnode.com", registry: VALIDATION_REGISTRY.mainnet }),
  84532: Object.freeze({ rpc: "https://sepolia.base.org", rpcFallback: "https://base-sepolia-rpc.publicnode.com", registry: VALIDATION_REGISTRY.testnet }),
  42220: Object.freeze({ rpc: "https://forno.celo.org", rpcFallback: "https://celo-rpc.publicnode.com", registry: VALIDATION_REGISTRY.mainnet }),
});

export const VALIDATION_SELECTORS = Object.freeze({
  getAgentValidations: "0x8d5d0c2d",
  getValidationStatus: "0xff2febfc",
});

// keccak256 of the event signatures, checked in test/validation.test.mjs.
export const VALIDATION_TOPICS = Object.freeze({
  response: "0xafddf629e874ccc3963b6a888c477bd464a6c8525024fc88759ea3b2326349ae",
  request: "0x530436c3634a98e1e626b0898be2f1e9980cc1bd2a78c07a0aba52d0a48a5059",
});

export const PASS_SCORE = 70;
const MAX_LOG_RANGE = 199; // sepolia.base.org: "eth_getLogs is limited to a 200 range"

function words(hex) {
  const body = typeof hex === "string" && hex.startsWith("0x") ? hex.slice(2) : "";
  const out = [];
  for (let i = 0; i + 64 <= body.length; i += 64) {
    out.push(body.slice(i, i + 64));
  }
  return out;
}

/** ABI bytes32[] -> list of 0x-hashes. Null when malformed. */
export function decodeBytes32Array(hex) {
  const w = words(hex);
  if (w.length < 2) {
    return null;
  }
  const offset = Number(BigInt(`0x${w[0]}`)) / 32;
  const n = Number(BigInt(`0x${w[offset]}`));
  if (!Number.isInteger(offset) || offset + 1 + n > w.length) {
    return null;
  }
  return w.slice(offset + 1, offset + 1 + n).map((x) => `0x${x}`);
}

/** getValidationStatus result -> {validator, agentId, response, responseHash, lastUpdate}. */
export function decodeValidationStatus(hex) {
  const w = words(hex);
  if (w.length < 6) {
    return null;
  }
  return {
    validator: `0x${w[0].slice(24)}`,
    agentId: BigInt(`0x${w[1]}`).toString(),
    response: Number(BigInt(`0x${w[2]}`)),
    responseHash: `0x${w[3]}`,
    lastUpdate: Number(BigInt(`0x${w[5]}`)),
  };
}

/**
 * Sort the statuses: scores >= 70 are answered for certain (a pending request reads 0); 1..69 are
 * answered lows; 0 needs the logs. Self-validations and validators not on the trusted list are set
 * aside (shown, not counted).
 */
export function classifyValidations(statuses, selfAddresses = [], { trusted = DEFAULT_VALIDATORS, chainId = null } = {}) {
  const self = new Set(selfAddresses.filter(Boolean).map((a) => a.toLowerCase()));
  const out = { high: [], low: [], zero: [], self: [], untrusted: [] };
  for (const s of statuses) {
    if (!s) {
      continue;
    }
    if (self.has(s.validator.toLowerCase())) {
      out.self.push(s);
    } else if (!trustedRow(trusted, s.validator, chainId ?? s.chainId)) {
      out.untrusted.push(s);
    } else if (s.response >= PASS_SCORE) {
      out.high.push(s);
    } else if (s.response > 0) {
      out.low.push(s);
    } else {
      out.zero.push(s);
    }
  }
  return out;
}

function group(list, reason, trusted, chainId) {
  const by = new Map();
  for (const s of list) {
    const k = s.validator.toLowerCase();
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].map(([validator, count]) => ({ validator, count, reason, name: (trustedRow(trusted, validator, chainId) || {}).name }));
}

/**
 * The second source as data for the engine.
 * :param c: classifyValidations() result, with zero[] entries carrying .resolved =
 *   "answered" | "pending" | "unknown" after the log lookup.
 * :param context: { trusted, chainId } for the counted / not-counted lists.
 */
export function validationSummary(c, { trusted = DEFAULT_VALIDATORS, chainId = null } = {}) {
  const answeredZero = c.zero.filter((z) => z.resolved === "answered");
  const unknown = c.zero.filter((z) => z.resolved !== "answered" && z.resolved !== "pending");
  const pending = c.zero.filter((z) => z.resolved === "pending");
  const countedList = [...c.high, ...c.low, ...answeredZero];
  return {
    passed: c.high.length,
    failed: c.low.length + answeredZero.length,
    pending: pending.length,
    unresolved: unknown.length,
    selfExcluded: c.self.length,
    untrusted: (c.untrusted || []).length,
    validators: [...new Set(countedList.map((s) => s.validator))],
    lowest: [...c.low, ...answeredZero].reduce((m, s) => (m === null || s.response < m ? s.response : m), null),
    counted: group(countedList, "on the trusted validator list", trusted, chainId),
    notCounted: [
      ...group(c.self, "self-score: the validator is the agent's own owner or agentWallet", trusted, chainId),
      ...group(c.untrusted || [], "not on the trusted validator list: shown, not counted", trusted, chainId),
      ...group(pending, "request never answered", trusted, chainId),
    ],
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(fetchImpl, chain, method, params, timeoutMs) {
  const r = await postChainRpc(fetchImpl, chain, { jsonrpc: "2.0", id: 1, method, params }, timeoutMs);
  if (!r.ok) {
    return { ok: false, error: r.error, attempts: r.attempts };
  }
  const j = r.json;
  return j && j.error ? { ok: false, error: `${j.error.code}: ${j.error.message}`, attempts: r.attempts, url: r.url } : { ok: true, result: j && j.result, attempts: r.attempts, url: r.url };
}

/** Several eth_calls in one JSON-RPC batch, so a page stays under the RPC's rate limit. */
async function batchCalls(fetchImpl, chain, to, datas, timeoutMs) {
  const out = new Array(datas.length).fill(null);
  let todo = datas.map((_, i) => i);
  const urls = chainRpcUrls(chain);
  for (const url of urls) {
    if (!todo.length) {
      break;
    }
    for (let round = 0; round < 2 && todo.length; round += 1) {
      if (round > 0) {
        await sleep(500 * 2 ** round);
      }
      const got = await timedFetch(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(todo.map((i) => ({ jsonrpc: "2.0", id: i, method: "eth_call", params: [{ to, data: datas[i] }, "latest"] }))) }, timeoutMs);
      if (!got.ok || got.response.status === 429) {
        break;
      }
      if (got.response.status !== 200) {
        break;
      }
      let json;
      try {
        json = await got.response.json();
      } catch {
        break;
      }
      const answers = Array.isArray(json) ? json : [json];
      for (const a of answers) {
        if (a && typeof a.id === "number" && typeof a.result === "string") {
          out[a.id] = a.result;
        }
      }
      todo = todo.filter((i) => out[i] === null);
    }
  }
  return todo.length ? { ok: false, error: `${todo.length} call(s) got no answer` } : { ok: true, results: out };
}

async function blockTs(fetchImpl, chain, n, timeoutMs) {
  const r = await rpc(fetchImpl, chain, "eth_getBlockByNumber", [`0x${n.toString(16)}`, false], timeoutMs);
  return r.ok && r.result ? parseInt(r.result.timestamp, 16) : null;
}

/** First block whose timestamp is >= ts, by interpolation search. Null on failure. */
export async function firstBlockAtOrAfter(fetchImpl, chain, ts, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const head = await rpc(fetchImpl, chain, "eth_blockNumber", [], timeoutMs);
  if (!head.ok) {
    return null;
  }
  let hi = parseInt(head.result, 16);
  let hiT = await blockTs(fetchImpl, chain, hi, timeoutMs);
  if (hiT === null || hiT < ts) {
    return null;
  }
  // Bracket from the head backwards: assume blocks no faster than 10 a second, then widen.
  let lo = hi;
  let loT = hiT;
  let step = Math.max(1, Math.ceil((hiT - ts) * 10));
  for (let i = 0; i < 12 && loT >= ts; i += 1) {
    hi = lo;
    hiT = loT;
    lo = Math.max(0, lo - step);
    loT = await blockTs(fetchImpl, chain, lo, timeoutMs);
    if (loT === null) {
      return null;
    }
    if (lo === 0) {
      break;
    }
    step *= 2;
  }
  if (loT >= ts) {
    return lo === 0 ? 0 : null;
  }
  for (let i = 0; i < 64 && hi - lo > 1; i += 1) {
    let mid = hiT > loT ? lo + Math.floor(((ts - loT) * (hi - lo)) / (hiT - loT)) : Math.floor((lo + hi) / 2);
    if (i % 3 === 2) {
      mid = Math.floor((lo + hi) / 2); // guard against slow interpolation
    }
    mid = Math.min(hi - 1, Math.max(lo + 1, mid));
    const t = await blockTs(fetchImpl, chain, mid, timeoutMs);
    if (t === null) {
      return null;
    }
    if (t >= ts) {
      hi = mid;
      hiT = t;
    } else {
      lo = mid;
      loT = t;
    }
  }
  return hi - lo <= 1 ? hi : null;
}

function topicUint(n) {
  return `0x${BigInt(n).toString(16).padStart(64, "0")}`;
}

/**
 * Find the ValidationResponse (or, failing that, ValidationRequest) log for one request at its
 * lastUpdate. Returns { kind, block, tx, logIndex, response? } or { kind: null, error? }.
 */
export async function locateValidationLog(fetchImpl, chain, status, requestHash, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const block = await firstBlockAtOrAfter(fetchImpl, chain, status.lastUpdate, timeoutMs);
  if (block === null) {
    return { kind: null, error: "block for lastUpdate not found" };
  }
  const range = { address: chain.registry, fromBlock: `0x${block.toString(16)}`, toBlock: `0x${(block + MAX_LOG_RANGE).toString(16)}` };
  for (const [kind, topic0] of [["response", VALIDATION_TOPICS.response], ["request", VALIDATION_TOPICS.request]]) {
    const r = await rpc(fetchImpl, chain, "eth_getLogs", [{ ...range, topics: [topic0, null, topicUint(status.agentId), requestHash] }], timeoutMs);
    if (!r.ok) {
      return { kind: null, error: `eth_getLogs: ${r.error}` };
    }
    const log = Array.isArray(r.result) ? r.result[0] : null;
    if (log) {
      const out = { kind, block: parseInt(log.blockNumber, 16), tx: log.transactionHash, logIndex: parseInt(log.logIndex, 16) };
      if (kind === "response") {
        out.response = Number(BigInt(log.data.slice(0, 66)));
      }
      return out;
    }
  }
  return { kind: null, error: `no log within ${MAX_LOG_RANGE + 1} blocks of lastUpdate` };
}

/**
 * Read every validation of one agent and judge it. Returns a pillar-like
 * { status: "ok", data } or { status: "unavailable", error }, with evidence locations.
 *
 */
export async function readValidations({ chainId, agentId, selfAddresses = [], trusted = DEFAULT_VALIDATORS }, fetchImpl, { timeoutMs = DEFAULT_TIMEOUT_MS, maxItems = 200, maxZeroLookups = 6 } = {}) {
  const chain = VALIDATION_CHAINS[Number(chainId)];
  if (!chain) {
    return { status: "unavailable", error: `no ValidationRegistry known on chain ${chainId}` };
  }
  const call = (data) => rpc(fetchImpl, chain, "eth_call", [{ to: chain.registry, data }, "latest"], timeoutMs);
  const list = await call(`${VALIDATION_SELECTORS.getAgentValidations}${BigInt(agentId).toString(16).padStart(64, "0")}`);
  if (!list.ok) {
    return { status: "unavailable", error: `getAgentValidations: ${list.error}` };
  }
  if (list.result === "0x") {
    return { status: "unavailable", error: `getAgentValidations returned an empty result: no contract at ${chain.registry}` };
  }
  const hashes = decodeBytes32Array(list.result);
  if (!hashes) {
    return { status: "unavailable", error: "getAgentValidations result is not a bytes32[]" };
  }
  const base = { registry: chain.registry, chainId: Number(chainId), agentId: String(agentId), total: hashes.length };
  if (hashes.length === 0) {
    return { status: "ok", data: { ...base, passed: 0, failed: 0, pending: 0, unresolved: 0, selfExcluded: 0, untrusted: 0, validators: [], lowest: null, counted: [], notCounted: [], evidence: [] } };
  }
  const used = hashes.slice(-maxItems);
  const statuses = [];
  for (let i = 0; i < used.length; i += 20) {
    const chunk = used.slice(i, i + 20);
    const r = await batchCalls(fetchImpl, chain, chain.registry, chunk.map((h) => `${VALIDATION_SELECTORS.getValidationStatus}${h.slice(2)}`), timeoutMs);
    if (!r.ok) {
      return { status: "unavailable", error: `getValidationStatus: ${r.error}` };
    }
    r.results.forEach((hex, j) => {
      const st = decodeValidationStatus(hex);
      if (st) {
        st.requestHash = chunk[j];
      }
      statuses.push(st);
    });
  }
  if (statuses.some((st) => st === null)) {
    return { status: "unavailable", error: "a getValidationStatus answer could not be decoded" };
  }
  const c = classifyValidations(statuses, selfAddresses, { trusted, chainId: Number(chainId) });
  const evidence = [];
  // A certain low already decides BLOCK: locate one for the record and skip resolving the zeros.
  if (c.low.length > 0) {
    const s = c.low[c.low.length - 1];
    evidence.push({ role: "lowest answered score", response: s.response, requestHash: s.requestHash, validator: s.validator, log: await locateValidationLog(fetchImpl, chain, s, s.requestHash, timeoutMs) });
  } else {
    for (const z of c.zero.slice(-maxZeroLookups)) {
      const log = await locateValidationLog(fetchImpl, chain, z, z.requestHash, timeoutMs);
      z.resolved = log.kind === "response" ? "answered" : log.kind === "request" ? "pending" : "unknown";
      z.log = log;
      evidence.push({ role: z.resolved === "answered" ? "answered score 0" : z.resolved === "pending" ? "request never answered (not counted)" : "score 0 not resolved", response: 0, requestHash: z.requestHash, validator: z.validator, log });
    }
  }
  if (c.high.length > 0) {
    const s = c.high.reduce((a, b) => (b.lastUpdate > a.lastUpdate ? b : a));
    evidence.push({ role: "latest passing score", response: s.response, requestHash: s.requestHash, validator: s.validator, log: await locateValidationLog(fetchImpl, chain, s, s.requestHash, timeoutMs) });
  }
  return { status: "ok", data: { ...base, ...validationSummary(c, { trusted, chainId: Number(chainId) }), evidence } };
}
