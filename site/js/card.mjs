import { vet402LastDeliveredFromData } from "./gate.mjs";

// What the verdict card shows, as plain data, so the page and the tests read the same thing.
// Three pillars side by side, each with its own effect (ALLOW / CAUTION / BLOCK / NOT APPLICABLE)
// and one line of evidence; three large counts above them (paid calls, delivered calls,
// passing validations). A count that was not measured is "—", never 0.

export const PILLARS = Object.freeze([
  Object.freeze({ key: "live", title: "Answers as declared", hint: "Pillar 1 · live probe" }),
  Object.freeze({ key: "identity", title: "Identity on chain", hint: "Pillar 2 · ERC-8004" }),
  Object.freeze({ key: "delivery", title: "Delivered after payment", hint: "Pillar 3 · vet402 + validations", note: "vet402 is the author's own service." }),
]);

export const DASH = "—";

// What each CAUTION kind means on the card (gate.mjs names the kinds).
export const KIND_TEXT = Object.freeze({
  identity_unknown: "who it is (no ERC-8004 registration speaks for it)",
  unreachable: "whether it answers (it, or a capability it declares, did not answer the browser)",
  steering: "instructions that try to steer the caller's model (found)",
  no_delivery_record: "whether paid calls came back with content (no record)",
  declined: "what you declined on a consent card",
  not_compared: "whether its answer matches its declaration",
  delivery_warn: "vet402 answers WARN",
  unknown: "a part that was not measured",
});

/** First sentence of a reason, cut to fit one line on a phone. */
export function oneLine(text, max = 140) {
  const s = String(text || "").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  const first = m ? m[1] : s;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

function label(effect) {
  return effect === "NOT_APPLICABLE" ? "NOT APPLICABLE" : effect;
}

function count(n) {
  return n === null || n === undefined || Number.isNaN(Number(n)) ? DASH : String(n);
}

/**
 * The card's first line: what to do, not the verdict word.
 *
 * :param verdict: ALLOW, CAUTION or BLOCK.
 * :param paid: true when the counterparty asks for payment (x402 terms), false when it does not.
 */
export function actionLine(verdict, paid) {
  if (verdict === "ALLOW") {
    return "Link / pay: OK";
  }
  if (verdict === "BLOCK") {
    return paid === true ? "Do not pay" : "Do not link";
  }
  return "Unchecked — do not treat as safe";
}

/**
 * What was measured and what was not, per pillar, from the reasons.
 *
 * :return: { measured: [string], notMeasured: [string], notApplicable: [string] }
 */
export function measuredOf(reasons) {
  const out = { measured: [], notMeasured: [], notApplicable: [] };
  const titles = Object.fromEntries(PILLARS.map((p) => [p.key, p.title]));
  for (const r of reasons || []) {
    const title = titles[r.pillar] || r.pillar;
    if (r.effect === "NOT_APPLICABLE") {
      out.notApplicable.push(title);
      continue;
    }
    const kinds = Array.isArray(r.kinds) ? r.kinds : [];
    const unmeasured = kinds.filter((k) => k !== "steering" && k !== "delivery_warn");
    if (r.effect === "CAUTION" && unmeasured.length) {
      out.notMeasured.push(`${title}: ${unmeasured.map((k) => KIND_TEXT[k] || k).join("; ")}`);
    } else {
      out.measured.push(`${title}: ${r.short || oneLine(r.text)}`);
    }
  }
  return out;
}

/**
 * :param result: a gateCheck() result: { url, checkedAt, verdict, reasons, counts, evidence? }.
 * :return: { verdict, action, cautions, measured, target, checkedAt, counts, pillars, nanda }
 */
export function verdictCard(result) {
  const counts = result.counts || {};
  const paid = result.evidence && result.evidence.delivery ? result.evidence.delivery.paid : result.paid;
  const deliveryPillar = result.evidence && result.evidence.delivery && result.evidence.delivery.pillar;
  const deliveryData = deliveryPillar && deliveryPillar.status === "ok" ? deliveryPillar.data : null;
  const lastDelivered = vet402LastDeliveredFromData(deliveryData);
  const reasons = result.reasons || [];
  const cautions = [...new Set(reasons.filter((r) => r.effect === "CAUTION").flatMap((r) => (Array.isArray(r.kinds) && r.kinds.length ? r.kinds : ["unknown"])))];
  const validations = counts.validationsPassed === null || counts.validationsPassed === undefined
    ? DASH
    : `passed ${count(counts.validationsPassed)} / below 70 ${count(counts.validationsFailed)}`;
  return {
    verdict: result.verdict,
    action: actionLine(result.verdict, paid),
    cautions: cautions.map((k) => ({ kind: k, text: KIND_TEXT[k] || k })),
    measured: measuredOf(reasons),
    target: result.url,
    checkedAt: result.checkedAt,
    counts: [
      { key: "paid", value: count(counts.paid), label: "paid calls (vet402)" },
      { key: "delivered", value: count(counts.delivered), label: "came back with content" },
      { key: "validationsPassed", value: validations, label: "validations, trusted (passed / below 70)" },
    ],
    pillars: PILLARS.map((p) => {
      const r = reasons.find((x) => x.pillar === p.key) || { effect: "CAUTION", text: "Not measured.", code: `${p.key}_missing` };
      return {
        key: p.key,
        title: p.title,
        hint: p.hint,
        note: p.note || "",
        effect: r.effect,
        label: label(r.effect),
        line: r.short || oneLine(r.text),
        lastDelivered: p.key === "delivery" && lastDelivered ? lastDelivered.line : "",
        detail: r.text,
        code: r.code,
      };
    }),
    nanda: result.nanda || null,
  };
}
