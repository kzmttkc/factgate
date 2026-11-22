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
// effect is ALLOW, CAUTION, BLOCK or NOT_APPLICABLE (pillar 3 of a counterparty with no 402).
// The verdict is the worst effect among the reasons.

export const VERDICTS = Object.freeze(["ALLOW", "CAUTION", "BLOCK"]);

// NOT_APPLICABLE (pillar 3 of a free counterparty) ranks with ALLOW: it does not stop ALLOW, but
// it is shown as "not applicable", never as a pass.
const RANK = { NOT_APPLICABLE: 0, ALLOW: 0, CAUTION: 1, BLOCK: 2 };

/**
 * The rules, as plain data, for the page and the bridge to show.
 */
export function gateRules() {
  return {
    engine: "deterministic, no LLM: the verdict is the worst effect among the three pillars",
    pillars: [
      "live: does the counterparty answer as declared, and can a browser reach it over CORS. The instructions of the network a caller would load are scanned: text that overrides the caller's rules, pulls out its context or points it to other sites is CAUTION; text that asks for a key, password or seed phrase is BLOCK",
      "identity: the site's declared ERC-8004 registration is read on chain (eth_call), then its owner and agentWallet are compared with the 402 payTo. A declaration that is not on chain is never ALLOW. A site that asks for no payment passes when pillar 1 passes and the site and its ERC-8004 registration point at each other (the site declares the agentId; the registration's services or agentURI name the site)",
      "delivery: for a paid counterparty, vet402's production record or ERC-8004 validation scores (>= 70, none below 70) show content came back; any record of an empty paid answer or a score below 70 is BLOCK; a counterparty with no 402 is not applicable (not a pass). Only validators on the trusted list count; others are shown, not counted",
    ],
    trustedValidators: "site/validators.json (the visitor can change it on the page)",
    unavailableRule: "A pillar whose data could not be fetched is CAUTION, never zero and never good.",
  };
}

// One short sentence per reason code, for the verdict card (never cut). The full text stays in
// `text`. kinds name what a CAUTION is about, so a caller can choose which ones it accepts:
//   identity_unknown   = who it is could not be measured (no ERC-8004 registration that speaks for it)
//   unreachable        = it, or a capability it declares, did not answer the browser
//   steering           = its agent instructions try to steer the caller's model
//   no_delivery_record = no record that a paid call came back with content
//   declined           = the visitor declined an origin, so that part was not measured
//   not_compared       = reached, but not compared with its declaration
//   delivery_warn      = vet402 answers WARN
export const SHORT = Object.freeze({
  live_as_declared: "Answers as it declares.",
  live_not_as_declared: "Its live answer contradicts its declaration.",
  live_instructions_ask_for_secrets: "Its instructions ask the caller for a key or password.",
  live_cors_unreachable: "A browser cannot reach it.",
  live_capability_unreachable: "A capability it declares did not answer.",
  live_instructions_suspicious: "Its instructions try to steer the caller's model.",
  live_unmeasured: "Reached, but not compared with its declaration.",
  live_unavailable: "Not measured: it could not be read.",
  identity_match: "Its payee is the wallet of its ERC-8004 registration.",
  identity_payee_mismatch: "Its payee is not the wallet of its ERC-8004 registration.",
  identity_bound_no_payment: "Site and ERC-8004 registration point at each other.",
  identity_bound_live_not_passed: "Bound on chain, but pillar 1 did not pass.",
  identity_not_mutual: "Its ERC-8004 registration does not point back to it.",
  identity_no_declared_payee: "It names no payee address to compare.",
  identity_declared_only: "Its declared registration is not on chain.",
  identity_unregistered: "No ERC-8004 registration found.",
  identity_unbound: "The registered agent does not claim this URL.",
  identity_unavailable: "Not measured: no ERC-8004 registration speaks for it.",
  delivery_delivered: "vet402 saw content come back after payment.",
  delivery_validated: "Trusted validators scored its deliveries 70 or more.",
  delivery_paid_empty: "A paid call came back empty.",
  delivery_vet402_block: "vet402 answers BLOCK.",
  delivery_validation_low: "A trusted validator scored a delivery below 70.",
  delivery_no_record: "No record of a paid call coming back yet.",
  delivery_vet402_warn: "vet402 answers WARN.",
  delivery_inconclusive: "The delivery record does not settle it.",
  delivery_unavailable: "Not measured: no delivery record could be read.",
  delivery_not_applicable: "Not applicable: it asks for no payment.",
  validation_low_score: "A trusted validator scored a delivery below 70.",
  validation_inconclusive: "Scores of 0 could not be told from unanswered requests.",
  validation_passed: "Trusted validators scored its deliveries 70 or more.",
  validation_no_record: "No score from a trusted validator.",
  validation_unavailable: "Not measured: no validation record could be read.",
});

const KIND = Object.freeze({
  live_cors_unreachable: "unreachable",
  live_capability_unreachable: "unreachable",
  live_unavailable: "unreachable",
  live_instructions_suspicious: "steering",
  live_unmeasured: "not_compared",
  delivery_vet402_warn: "delivery_warn",
});

function kindsOf(pillar, code, effect, text) {
  if (effect !== "CAUTION") {
    return [];
  }
  if (/_unavailable$/.test(code) && /declined/.test(text)) {
    return ["declined"];
  }
  if (KIND[code]) {
    return [KIND[code]];
  }
  if (pillar === "identity") {
    return ["identity_unknown"];
  }
  if (pillar === "delivery" || pillar === "validation") {
    return ["no_delivery_record"];
  }
  return ["unknown"];
}

function reason(pillar, code, effect, text) {
  return { pillar, code, effect, text, short: SHORT[code] || `${effect}.`, kinds: kindsOf(pillar, code, effect, text) };
}

/**
 * The kinds of CAUTION in a verdict, without repeats (see SHORT above for the names).
 */
export function cautionKinds(reasons) {
  return [...new Set((reasons || []).filter((r) => r.effect === "CAUTION").flatMap((r) => (Array.isArray(r.kinds) && r.kinds.length ? r.kinds : ["unknown"])))];
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

function findingText(findings) {
  return findings.slice(0, 3).map((f) => `${f.agent}: "${f.excerpt}" (${f.rule})`).join("; ");
}

/**
 * Judge pillar 1: does the counterparty answer as it declares, can a browser reach it, and do the
 * instructions a caller would load try to steer the caller's model.
 */
export function judgeLive(live) {
  if (!isOk(live)) {
    return unavailable(live, "live", "live probe");
  }
  const d = live.data;
  const findings = Array.isArray(d.instructionFindings) ? d.instructionFindings : [];
  const blocking = findings.filter((f) => f.severity === "block");
  const cautions = findings.filter((f) => f.severity !== "block");
  if (d.answersAsDeclared === false || blocking.length) {
    const parts = [];
    let code = "live_not_as_declared";
    if (d.answersAsDeclared === false) {
      parts.push(`The live answer does not match what the counterparty declares${d.detail ? ` (${d.detail})` : ""}.`);
    }
    if (blocking.length) {
      code = d.answersAsDeclared === false ? code : "live_instructions_ask_for_secrets";
      parts.push(`Its agent instructions ask the caller for a key, password or seed phrase: ${findingText(blocking)}.`);
    }
    return reason("live", code, "BLOCK", parts.join(" "));
  }
  if (d.corsReachable === false) {
    return reason("live", "live_cors_unreachable", "CAUTION", "The browser cannot reach this counterparty over CORS, so an agentic website cannot connect to it.");
  }
  const unreachable = Array.isArray(d.unreachable) ? d.unreachable : [];
  if (unreachable.length > 0) {
    const extra = cautions.length ? ` Its instructions also try to steer the caller: ${findingText(cautions)}.` : "";
    const r = reason("live", "live_capability_unreachable", "CAUTION", `A declared capability did not answer the browser: ${unreachable.join("; ")}. Not measured, not counted as a mismatch.${extra}`);
    return cautions.length ? { ...r, kinds: ["unreachable", "steering"], short: "A declared capability did not answer, and its instructions steer the caller." } : r;
  }
  if (cautions.length) {
    return reason("live", "live_instructions_suspicious", "CAUTION", `Its agent instructions try to steer the caller's model: ${findingText(cautions)}. A caller would load these instructions as untrusted input (spec section 5).`);
  }
  if (d.answersAsDeclared === true) {
    return reason("live", "live_as_declared", "ALLOW", "The live answer matches the declaration.");
  }
  return reason("live", "live_unmeasured", "CAUTION", "Reachable, but the answer was not compared with the declaration.");
}

/**
 * Judge pillar 2: does the declared payee match the ERC-8004 owner, agentWallet or payTo. A
 * counterparty that asks for no payment has no payee: it passes when pillar 1 passed and the
 * site and its on-chain registration point at each other.
 *
 * :param identity: The pillar.
 * :param context: { paid, liveOk } from the other pillars.
 */
export function judgeIdentity(identity, context = {}) {
  if (!isOk(identity)) {
    return unavailable(identity, "identity", "identity registration");
  }
  const d = identity.data;
  const rawDeclared = Array.isArray(d.declaredPayTos) && d.declaredPayTos.length ? d.declaredPayTos : [d.declaredPayTo];
  const declared = [...new Set(rawDeclared.map(normAddress).filter(Boolean))];
  if (declared.length === 0) {
    const reg = d.registered;
    if (context.paid === false && reg) {
      const at = reg.readAt ? ` [${reg.readAt}]` : "";
      if (reg.mutual === true && context.liveOk === true) {
        return reason("identity", "identity_bound_no_payment", "ALLOW", `No payment is asked, so there is no payee to compare. The site declares this ERC-8004 agent and the agent's registration points back to the site (${reg.how || "both directions"})${at}.`);
      }
      if (reg.mutual === true) {
        return reason("identity", "identity_bound_live_not_passed", "CAUTION", `The site and its ERC-8004 registration point at each other${at}, but pillar 1 did not pass, so the binding alone is not enough.`);
      }
      return reason("identity", "identity_not_mutual", "CAUTION", `No payment is asked. The ERC-8004 registration and the site do not point at each other (${reg.how || "one direction only"})${at}, so the registration does not speak for this site.`);
    }
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
  const at = d.registered.readAt ? ` [${d.registered.readAt}: owner ${normAddress(d.registered.owner) || "-"}, agentWallet ${normAddress(d.registered.agentWallet) || "-"}]` : "";
  const strangers = declared.filter((a) => !registered.includes(a));
  if (strangers.length > 0) {
    if (d.registered.bound === false) {
      return reason("identity", "identity_unbound", "CAUTION", `The declared payee ${strangers.join(", ")} is not this ERC-8004 agent's, but the agent does not claim this URL either, so the comparison proves nothing${at}.`);
    }
    return reason("identity", "identity_payee_mismatch", "BLOCK", `The declared payee ${strangers.join(", ")} is not the ERC-8004 owner, agentWallet or payTo${at}.`);
  }
  return reason("identity", "identity_match", "ALLOW", `The declared payee matches the ERC-8004 registration${at}.`);
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
 * Pillar 3, second source: ERC-8004 ValidationRegistry scores for the counterparty's agent.
 * data: { passed, failed, pending, unresolved, selfExcluded, validators, lowest, evidence, chainId, agentId }
 */
export function judgeValidation(validation) {
  if (!isOk(validation)) {
    return unavailable(validation, "validation", "ERC-8004 validation record");
  }
  const d = validation.data;
  const where = (role) => {
    const e = Array.isArray(d.evidence) ? d.evidence.find((x) => x.role === role) : null;
    return e && e.log && e.log.tx ? ` (tx ${e.log.tx}, block ${e.log.block}, log ${e.log.logIndex})` : "";
  };
  const agent = `agent ${d.agentId} on chain ${d.chainId}`;
  if (Number(d.failed) > 0) {
    return reason("validation", "validation_low_score", "BLOCK", `ERC-8004 validators scored ${agent} below 70 ${d.failed} time(s), lowest ${d.lowest}${where("lowest answered score") || where("answered score 0")}. Same as a paid answer that came back empty.`);
  }
  if (Number(d.unresolved) > 0) {
    return reason("validation", "validation_inconclusive", "CAUTION", `${d.unresolved} score(s) of 0 for ${agent} could not be told apart from unanswered requests, so the record cannot pass.`);
  }
  const shownOnly = Number(d.untrusted) > 0 ? ` ${d.untrusted} score(s) from validators not on the trusted list are shown, not counted.` : "";
  if (Number(d.passed) > 0) {
    return reason("validation", "validation_passed", "ALLOW", `Trusted ERC-8004 validators (${(d.validators || []).join(", ")}) scored ${agent} 70 or more ${d.passed} time(s) and never below 70${where("latest passing score")}.${shownOnly}`);
  }
  return reason("validation", "validation_no_record", "CAUTION", `No answered ERC-8004 validation from a trusted validator for ${agent}.${shownOnly}`);
}

/**
 * Pillar 3 from its two sources. A free counterparty (no 402) is "not applicable": it does not
 * stop ALLOW, and the reason says it is not a pass. A paid one passes on a delivered record from
 * either source; any BLOCK from either source is BLOCK; with no record anywhere it is CAUTION.
 */
export function judgeDeliveryPillar({ delivery, validation, paid }) {
  if (paid === false) {
    return { ...reason("delivery", "delivery_not_applicable", "NOT_APPLICABLE", "Not applicable: the counterparty asks for no payment, so there is no paid delivery to record. This is not a pass."), applicable: false };
  }
  const v402 = judgeDelivery(delivery);
  if (validation === undefined) {
    return v402;
  }
  const val = judgeValidation(validation);
  const both = `vet402: ${v402.text} ERC-8004 validation: ${val.text}`;
  const sources = [v402, val];
  if (v402.effect === "BLOCK" || val.effect === "BLOCK") {
    const code = v402.effect === "BLOCK" ? v402.code : "delivery_validation_low";
    return { ...reason("delivery", code, "BLOCK", both), sources };
  }
  if (v402.effect === "ALLOW" || val.effect === "ALLOW") {
    const code = v402.effect === "ALLOW" ? v402.code : "delivery_validated";
    return { ...reason("delivery", code, "ALLOW", both), sources };
  }
  let code = "delivery_no_record";
  if (v402.code === "delivery_unavailable" && val.code === "validation_unavailable") {
    code = "delivery_unavailable";
  } else if (v402.code !== "delivery_unavailable") {
    code = v402.code;
  } else if (val.code === "validation_inconclusive") {
    code = "delivery_inconclusive";
  }
  return { ...reason("delivery", code, "CAUTION", both), sources };
}

/**
 * Combine the three pillars into one verdict.
 *
 * :param input: { live, identity, delivery, validation?, paid? }, each a pillar result or missing.
 *   validation is pillar 3's second source; paid false marks a counterparty with no 402.
 * :return: { verdict, reasons }.
 */
export function evaluateGate(input) {
  const pillars = input && typeof input === "object" ? input : {};
  const live = judgeLive(pillars.live);
  const reasons = [
    live,
    judgeIdentity(pillars.identity, { paid: pillars.paid, liveOk: live.effect === "ALLOW" }),
    judgeDeliveryPillar({ delivery: pillars.delivery, validation: pillars.validation, paid: pillars.paid }),
  ];
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
 * From vet402 check_x402_seller structuredContent: one card line and facts for AgentFacts.
 * Returns null when last_delivered_at is missing (no guess).
 */
export function vet402LastDeliveredFromData(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const age = data.evidence_age;
  if (!age || typeof age !== "object") {
    return null;
  }
  const raw = age.last_delivered_at;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const stale = age.stale_after_days;
  const windowDays = stale === undefined || stale === null || Number.isNaN(Number(stale)) ? null : Number(stale);
  let line = `Last delivered: ${m[1]}`;
  if (windowDays !== null) {
    line += ` (vet402 window: ${windowDays} days)`;
  }
  return {
    line,
    last_delivered_at: raw.trim(),
    stale_after_days: windowDays,
    tier: typeof age.tier === "string" ? age.tier : undefined,
  };
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
