// One full FactGate check of a counterparty URL: pillar 1 (live probe), pillar 2 (declared
// ERC-8004 registration -> on-chain read -> payee comparison), pillar 3 (vet402 record), then
// the deterministic verdict and the AgentFacts output. Read-only everywhere: GET requests,
// MCP initialize/tools/list, eth_call and vet402's read tool. It never pays or signs.
//
// The same function runs on the page, in the action bridge and in scripts/probe-live.mjs; only
// the fetch function differs.
import { buildAgentFacts } from "./agentfacts.mjs";
import { CHAINS, bindingOf, decodeDataUriJson, evmPayTos, identityPillar, pickRegistration, readAgent } from "./chain.mjs";
import { deliveryFromMcp, evaluateGate } from "./gate.mjs";
import { DEFAULT_TIMEOUT_MS, parseJson, readText, timedFetch } from "./net.mjs";
import { parseRpcBody, probeLive } from "./probe.mjs";

export const VET402_MCP = "https://vet402.com/mcp";

/** Ask vet402.com/mcp for its delivery record of one x402 URL. Returns pillar 3 and the HTTP log. */
export async function fetchVet402Delivery(fetchImpl, url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const got = await timedFetch(fetchImpl, VET402_MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_x402_seller", arguments: { url } } }),
  }, timeoutMs);
  const http = { url: VET402_MCP, method: "POST tools/call check_x402_seller", argument: url };
  if (!got.ok) {
    return { pillar: { status: "unavailable", error: got.error }, http: { ...http, error: got.error } };
  }
  http.status = got.response.status;
  if (got.response.status !== 200) {
    return { pillar: { status: "unavailable", error: `vet402 MCP HTTP ${got.response.status}` }, http };
  }
  const rpc = parseRpcBody(await readText(got.response));
  return { pillar: deliveryFromMcp(rpc), http };
}

function deliveryTargetOf(url, live) {
  const terms = live.declared && live.declared.terms;
  if (!terms) {
    return { target: null, why: "no x402 terms, so there is no paid delivery for vet402 to have recorded" };
  }
  if (live.checks && live.checks.payment && live.checks.payment.source && !/declared/.test(live.checks.payment.source)) {
    return { target: url };
  }
  const trust = live.declared.trust;
  return { target: (trust && trust.resourceUrl) || terms.resourceUrl || url };
}

async function registrationFromUri(fetchImpl, tokenURI, live, timeoutMs) {
  if (typeof tokenURI !== "string" || tokenURI === "") {
    return { file: null, how: "no agentURI" };
  }
  if (tokenURI.startsWith("data:")) {
    return { file: decodeDataUriJson(tokenURI), how: "data: URI on chain" };
  }
  if (live.declared && live.declared.registrationUrl === tokenURI && live.declared.registrationFile) {
    return { file: live.declared.registrationFile, how: "same file as the declared registration" };
  }
  if (/^https:\/\//.test(tokenURI)) {
    const got = await timedFetch(fetchImpl, tokenURI, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
    if (!got.ok) {
      return { file: null, how: `agentURI not readable from the browser: ${got.error}` };
    }
    const json = got.response.status === 200 ? parseJson(await readText(got.response)) : null;
    return { file: json && typeof json === "object" ? json : null, how: `agentURI HTTP ${got.response.status}` };
  }
  return { file: null, how: `agentURI scheme not read (${tokenURI.split(":")[0]})` };
}

/**
 * :param target: { url, agentId?, chainId? }. agentId/chainId override the declared registration.
 * :param options: { fetch, timeoutMs?, now?, skipDelivery? }
 */
export async function gateCheck(target, options) {
  const fetchImpl = options.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const checkedAt = options.now ? options.now() : new Date().toISOString();
  const url = String(target.url || "").trim();

  const live = await probeLive(url, { fetch: fetchImpl, timeoutMs });

  // Pillar 2, in order: the registration the site declares -> the chain -> the 402 payTo.
  const payTos = evmPayTos(live.declared && live.declared.terms);
  const idEvidence = { payTos, source: null, agent: null, pick: null, chainRead: null, registrationFromChain: null, binding: null };
  let agent = null;
  let noAgentReason = null;
  let declaredOnlyReason = null;
  const given = target.agentId !== undefined && target.agentId !== null && String(target.agentId).trim() !== "";
  if (given) {
    agent = { chainId: Number(target.chainId) || 8453, agentId: String(target.agentId).trim() };
    idEvidence.source = "given by the visitor";
  } else {
    const pick = pickRegistration(live.declared && live.declared.registrationFile);
    idEvidence.pick = pick;
    if (pick.chosen) {
      agent = pick.chosen;
      idEvidence.source = `declared in ${live.declared.registrationUrl}`;
    } else if (pick.declared > 0) {
      declaredOnlyReason = pick.skipped.join("; ");
      idEvidence.source = `declared in ${live.declared.registrationUrl}, not readable on any chain FactGate reads`;
    } else {
      noAgentReason = "the counterparty declares no ERC-8004 registration (no readable /.well-known/agent-registration.json) and none was given";
    }
  }
  let chainRead = null;
  let binding = null;
  if (agent) {
    const chain = CHAINS[agent.chainId];
    idEvidence.agent = { ...agent, chain: chain ? chain.name : null, registry: chain ? chain.registry : null, rpc: chain ? chain.rpc : null };
    chainRead = await readAgent(agent, fetchImpl, timeoutMs);
    idEvidence.chainRead = chainRead;
    if (chainRead.ok && chainRead.exists) {
      const fromChain = await registrationFromUri(fetchImpl, chainRead.tokenURI, live, timeoutMs);
      idEvidence.registrationFromChain = { how: fromChain.how, name: fromChain.file && fromChain.file.name };
      binding = bindingOf({ targetUrl: url, chainId: agent.chainId, agentId: agent.agentId, wellKnown: live.declared.registrationFile, tokenURI: chainRead.tokenURI, registrationFile: fromChain.file });
      idEvidence.binding = binding;
    }
  }
  const identity = identityPillar({ payTos, chainRead, binding, noAgentReason, declaredOnlyReason });

  // Pillar 3.
  let delivery;
  const dt = deliveryTargetOf(url, live);
  const delEvidence = { target: dt.target, http: null };
  if (options.skipDelivery) {
    delivery = { status: "unavailable", error: "not read in this call" };
  } else if (!dt.target) {
    delivery = { status: "unavailable", error: dt.why };
  } else if (!/^https:\/\//.test(dt.target)) {
    delivery = { status: "unavailable", error: `vet402 records public https sellers only; ${dt.target} is not one` };
  } else {
    const got = await fetchVet402Delivery(fetchImpl, dt.target, timeoutMs);
    delivery = got.pillar;
    delEvidence.http = got.http;
  }

  const verdict = evaluateGate({ live: live.pillar, identity, delivery });
  const evidence = {
    live: { pillar: live.pillar, checks: live.checks, declared: live.declared, http: live.http },
    identity: { pillar: identity, ...idEvidence },
    delivery: { pillar: delivery, ...delEvidence },
  };
  const agentFacts = buildAgentFacts({ url, checkedAt, verdict, live: evidence.live, identity: evidence.identity, delivery: evidence.delivery });
  return { url, checkedAt, verdict: verdict.verdict, reasons: verdict.reasons, evidence, agentFacts };
}

/** The few values a model or a partner site needs, without the full HTTP log. */
export function summarizeCheck(result) {
  const e = result.evidence;
  const reg = e.identity.chainRead && e.identity.chainRead.ok && e.identity.chainRead.exists ? e.identity.chainRead : null;
  return {
    ok: true,
    url: result.url,
    checkedAt: result.checkedAt,
    verdict: result.verdict,
    reasons: result.reasons,
    live: {
      corsReachable: e.live.pillar.data ? e.live.pillar.data.corsReachable : null,
      detail: e.live.pillar.data ? e.live.pillar.data.detail : e.live.pillar.error,
      manifest: e.live.checks.manifest ? e.live.checks.manifest.state : null,
      mcp: (e.live.checks.mcp || []).map((m) => ({ url: m.url, state: m.state, missing: m.missing, error: m.error })),
      payment: e.live.declared.terms ? e.live.declared.terms.accepts.slice(0, 5).map((a) => ({ network: a.network, amount: a.amount, payTo: a.payTo })) : null,
      paymentSource: e.live.declared.termsSource,
    },
    identity: {
      status: e.identity.pillar.status,
      source: e.identity.source,
      agent: e.identity.agent ? { chainId: e.identity.agent.chainId, agentId: e.identity.agent.agentId } : null,
      owner: reg ? reg.owner : null,
      agentWallet: reg ? reg.agentWallet : null,
      bound: e.identity.binding ? e.identity.binding.bound : null,
      error: e.identity.pillar.error,
    },
    delivery: {
      status: e.delivery.pillar.status,
      recommendation: e.delivery.pillar.data ? e.delivery.pillar.data.recommendation : null,
      record: e.delivery.pillar.data && e.delivery.pillar.data.delivery ? e.delivery.pillar.data.delivery : null,
      error: e.delivery.pillar.error,
    },
    agentFacts: "The full AgentFacts JSON with every source URL is on the FactGate page (Download AgentFacts).",
  };
}
