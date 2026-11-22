// FactGate verdict engine. Pure functions: no network, no LLM, no clock, no input mutation.
//
// Input: the results of the three pillars.
//   live:     { status: "ok", data: { corsReachable, answersAsDeclared, detail? } }
//   identity: { status: "ok", data: { declaredPayTo, registered: { owner, agentWallet, payTo } | null } }
//   delivery: { status: "ok", data: <vet402 check_x402_seller structuredContent> }
// A pillar whose data could not be fetched is { status: "unavailable", error }.
// A missing pillar counts as unavailable. Unavailable is never read as zero or as good.
//
// Output: { verdict: "ALLOW" | "CAUTION" | "BLOCK", reasons: [{ pillar, code, effect, text }] }
// The verdict is the worst effect among the reasons.

export const VERDICTS = Object.freeze(["ALLOW", "CAUTION", "BLOCK"]);

const RANK = { ALLOW: 0, CAUTION: 1, BLOCK: 2 };

/**
 * The rules, as plain data, for the page and the bridge to show.
 */
export function gateRules() {
  return {
    engine: "deterministic, no LLM: the verdict is the worst effect among the three pillars",
    pillars: [
      "live: does the counterparty answer as declared, and can a browser reach it over CORS",
      "identity: the site's declared ERC-8004 registration is read on chain (eth_call), then its owner and agentWallet are compared with the 402 payTo. A declaration that is not on chain is never ALLOW",
      "delivery: does vet402's production record show content came back after payment",
    ],
    unavailableRule: "A pillar whose data could not be fetched is CAUTION, never zero and never good.",
  };
}

function reason(pillar, code, effect, text) {
  return { pillar, code, effect, text };
}

function isOk(pillar) {
  return Boolean(pillar) && pillar.status === "ok" && pillar.data && typeof pillar.data === "object";
}

function unavailable(pillar, name, label) {
  const why = pillar && pillar.error ? `: ${String(pillar.error)}` : "";
  return reason(name, `${name}_unavailable`, "CAUTION", `Could not fetch the ${label}${why}. Not measured, not counted as zero.`);
}

function normAddress(value) {
  if (typeof value !== "string") {
    return null;
  }
  const v = value.trim().toLowerCase();
  // The zero address is "not set" in ERC-8004 (agentWallet is cleared on transfer), never a payee.
  return /^0x[0-9a-f]{40}$/.test(v) && !/^0x0{40}$/.test(v) ? v : null;
}

/**
 * Judge pillar 1: does the counterparty answer as it declares, and can a browser reach it.
 */
export function judgeLive(live) {
  if (!isOk(live)) {
    return unavailable(live, "live", "live probe");
  }
  const d = live.data;
  if (d.corsReachable === false) {
    return reason("live", "live_cors_unreachable", "CAUTION", "The browser cannot reach this counterparty over CORS, so an agentic website cannot connect to it.");
  }
  if (d.answersAsDeclared === false) {
    const detail = d.detail ? ` (${d.detail})` : "";
    return reason("live", "live_not_as_declared", "BLOCK", `The live answer does not match what the counterparty declares${detail}.`);
  }
  const unreachable = Array.isArray(d.unreachable) ? d.unreachable : [];
  if (unreachable.length > 0) {
    return reason("live", "live_capability_unreachable", "CAUTION", `A declared capability did not answer the browser: ${unreachable.join("; ")}. Not measured, not counted as a mismatch.`);
  }
  if (d.answersAsDeclared === true) {
    return reason("live", "live_as_declared", "ALLOW", "The live answer matches the declaration.");
  }
  return reason("live", "live_unmeasured", "CAUTION", "Reachable, but the answer was not compared with the declaration.");
}

/**
 * Judge pillar 2: does the declared payee match the ERC-8004 owner, agentWallet or payTo.
 */
export function judgeIdentity(identity) {
  if (!isOk(identity)) {
    return unavailable(identity, "identity", "identity registration");
  }
  const d = identity.data;
  const rawDeclared = Array.isArray(d.declaredPayTos) && d.declaredPayTos.length ? d.declaredPayTos : [d.declaredPayTo];
  const declared = [...new Set(rawDeclared.map(normAddress).filter(Boolean))];
  if (declared.length === 0) {
    return reason("identity", "identity_no_declared_payee", "CAUTION", "The counterparty declares no valid payee address to compare.");
  }
  if (!d.registered) {
    if (d.declaredOnly) {
      const why = d.declaredReason ? ` (${d.declaredReason})` : "";
      return reason("identity", "identity_declared_only", "CAUTION", `The counterparty declares an ERC-8004 registration, but there is no matching registration on chain${why}. A declaration alone is not an identity.`);
    }
    return reason("identity", "identity_unregistered", "CAUTION", "No ERC-8004 registration was found for this counterparty.");
  }
  const registered = [d.registered.owner, d.registered.agentWallet, d.registered.payTo].map(normAddress).filter(Boolean);
  if (registered.length === 0) {
    return reason("identity", "identity_unregistered", "CAUTION", "The ERC-8004 registration names no owner, agentWallet or payTo.");
  }
  const strangers = declared.filter((a) => !registered.includes(a));
  if (strangers.length > 0) {
    if (d.registered.bound === false) {
      return reason("identity", "identity_unbound", "CAUTION", `The declared payee ${strangers.join(", ")} is not this ERC-8004 agent's, but the agent does not claim this URL either, so the comparison proves nothing.`);
    }
    return reason("identity", "identity_payee_mismatch", "BLOCK", `The declared payee ${strangers.join(", ")} is not the ERC-8004 owner, agentWallet or payTo.`);
  }
  return reason("identity", "identity_match", "ALLOW", "The declared payee matches the ERC-8004 registration.");
}

/**
 * Judge pillar 3: does vet402's production record show content came back after payment.
 */
export function judgeDelivery(delivery) {
  if (!isOk(delivery)) {
    return unavailable(delivery, "delivery", "vet402 delivery record");
  }
  const d = delivery.data;
  const codes = Array.isArray(d.reason_codes) ? d.reason_codes : [];
  const stats = d.delivery && typeof d.delivery === "object" ? d.delivery : null;
  if ((stats && Number(stats.settled_not_delivered) > 0) || codes.includes("l1_paid_not_delivered")) {
    return reason("delivery", "delivery_paid_empty", "BLOCK", "vet402 recorded a payment that settled but brought back no content.");
  }
  if (d.recommendation === "BLOCK") {
    return reason("delivery", "delivery_vet402_block", "BLOCK", `vet402 answers BLOCK (${codes.join(", ") || "no reason codes"}).`);
  }
  if (d.not_in_catalog === true || !stats || !(Number(stats.paid_attempts) > 0)) {
    return reason("delivery", "delivery_no_record", "CAUTION", "vet402 has no paid test of this counterparty yet. No record is not the same as a bad record.");
  }
  if (d.recommendation === "WARN") {
    return reason("delivery", "delivery_vet402_warn", "CAUTION", `vet402 answers WARN (${codes.join(", ") || "no reason codes"}).`);
  }
  if (d.recommendation === "ALLOW" && Number(stats.delivered) > 0) {
    return reason("delivery", "delivery_delivered", "ALLOW", `vet402 recorded content coming back on ${stats.delivered} of ${stats.paid_attempts} paid tests.`);
  }
  return reason("delivery", "delivery_inconclusive", "CAUTION", "The vet402 record does not settle whether content comes back.");
}

/**
 * Combine the three pillars into one verdict.
 *
 * :param input: { live, identity, delivery }, each a pillar result or missing.
 * :return: { verdict, reasons }.
 */
export function evaluateGate(input) {
  const pillars = input && typeof input === "object" ? input : {};
  const reasons = [judgeLive(pillars.live), judgeIdentity(pillars.identity), judgeDelivery(pillars.delivery)];
  let verdict = "ALLOW";
  for (const r of reasons) {
    if (RANK[r.effect] > RANK[verdict]) {
      verdict = r.effect;
    }
  }
  return { verdict, reasons };
}

/**
 * Turn a vet402 MCP tools/call JSON-RPC response for check_x402_seller into pillar 3.
 * A JSON-RPC error, a tool error or an unreadable body is "unavailable", never a zero record.
 */
export function deliveryFromMcp(rpc) {
  if (!rpc || typeof rpc !== "object") {
    return { status: "unavailable", error: "no response" };
  }
  if (rpc.error) {
    return { status: "unavailable", error: `JSON-RPC error ${rpc.error.code}: ${rpc.error.message}` };
  }
  const result = rpc.result;
  if (!result || typeof result !== "object") {
    return { status: "unavailable", error: "no result" };
  }
  let data = result.structuredContent;
  if (!data && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === "string") {
    try {
      data = JSON.parse(result.content[0].text);
    } catch {
      data = null;
    }
  }
  if (result.isError) {
    const msg = data && (data.message || data.error) ? data.message || data.error : "tool error";
    return { status: "unavailable", error: String(msg) };
  }
  if (!data || typeof data !== "object") {
    return { status: "unavailable", error: "unreadable tool result" };
  }
  return { status: "ok", data };
}

/**
 * Turn a browser-side probe of the counterparty into pillar 1.
 *
 * :param probe: { fetchError?, httpStatus?, allowOrigin?, matchesDeclaration? }. In a browser a
 *   CORS refusal surfaces only as a TypeError from fetch, the same as a network failure.
 *   Both mean an agentic website cannot connect, so both are corsReachable false.
 */
export function liveFromProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return { status: "unavailable", error: "no probe" };
  }
  if (probe.fetchError) {
    return { status: "ok", data: { corsReachable: false, answersAsDeclared: null, detail: String(probe.fetchError) } };
  }
  if (!probe.allowOrigin) {
    return { status: "ok", data: { corsReachable: false, answersAsDeclared: null, detail: `HTTP ${probe.httpStatus} without Access-Control-Allow-Origin` } };
  }
  const matches = typeof probe.matchesDeclaration === "boolean" ? probe.matchesDeclaration : null;
  return { status: "ok", data: { corsReachable: true, answersAsDeclared: matches, detail: `HTTP ${probe.httpStatus}` } };
}

const LIVE_ANSWER = { yes: true, no: false, not_compared: null };

function missing(fields, obj) {
  return fields.filter((f) => obj[f] === undefined || obj[f] === null);
}

/**
 * Turn flat, typed action arguments into the engine's pillar results.
 * The runtime's action schemas allow only fixed fields, so a pillar arrives as
 *   live:     { status, error?, corsReachable, answersAsDeclared: "yes"|"no"|"not_compared", detail? }
 *   identity: { status, error?, declaredPayTo, registered, owner?, agentWallet?, payTo? }
 *   delivery: { status, error?, recommendation, reasonCodes, paidAttempts, delivered, settledNotDelivered, notInCatalog }
 * A pillar marked "ok" but missing a field the engine needs becomes "unavailable" with the
 * missing fields named. It is never filled in with zeros.
 */
export function pillarsFromArgs(args) {
  const a = args && typeof args === "object" ? args : {};
  const out = {};
  for (const name of ["live", "identity", "delivery"]) {
    const p = a[name];
    if (!p || typeof p !== "object") {
      continue;
    }
    if (p.status !== "ok") {
      out[name] = { status: "unavailable", error: p.error || "not fetched" };
      continue;
    }
    let need;
    let data;
    if (name === "live") {
      need = missing(["corsReachable"], p);
      data = { corsReachable: p.corsReachable, answersAsDeclared: Object.hasOwn(LIVE_ANSWER, p.answersAsDeclared) ? LIVE_ANSWER[p.answersAsDeclared] : null, detail: p.detail, unreachable: Array.isArray(p.unreachable) ? p.unreachable : [] };
    } else if (name === "identity") {
      need = missing(["declaredPayTo", "registered"], p);
      data = {
        declaredPayTo: p.declaredPayTo,
        declaredOnly: p.declaredOnly === true,
        registered: p.registered ? { owner: p.owner, agentWallet: p.agentWallet, payTo: p.payTo, bound: typeof p.bound === "boolean" ? p.bound : undefined } : null,
      };
    } else if (p.notInCatalog === true) {
      need = [];
      data = { not_in_catalog: true, recommendation: p.recommendation, reason_codes: p.reasonCodes || [] };
    } else {
      need = missing(["recommendation", "paidAttempts", "delivered", "settledNotDelivered"], p);
      data = {
        recommendation: p.recommendation,
        reason_codes: p.reasonCodes || [],
        delivery: { paid_attempts: p.paidAttempts, delivered: p.delivered, settled_not_delivered: p.settledNotDelivered },
        not_in_catalog: false,
      };
    }
    out[name] = need.length ? { status: "unavailable", error: `marked ok but missing ${need.join(", ")}` } : { status: "ok", data };
  }
  return out;
}
