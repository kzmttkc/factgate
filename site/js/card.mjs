// What the verdict card shows, as plain data, so the page and the tests read the same thing.
// Three pillars side by side, each with its own effect (ALLOW / CAUTION / BLOCK / NOT APPLICABLE)
// and one line of evidence; three large counts above them (paid calls, delivered calls,
// passing validations). A count that was not measured is "—", never 0.

export const PILLARS = Object.freeze([
  Object.freeze({ key: "live", title: "Answers as declared", hint: "Pillar 1 · live probe" }),
  Object.freeze({ key: "identity", title: "Identity on chain", hint: "Pillar 2 · ERC-8004" }),
  Object.freeze({ key: "delivery", title: "Delivered after payment", hint: "Pillar 3 · vet402 + validations" }),
]);

export const DASH = "—";

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
 * :param result: a gateCheck() result: { url, checkedAt, verdict, reasons, counts }.
 * :return: { verdict, target, checkedAt, counts: [{ key, value, label }], pillars: [{ key, title, hint, effect, label, line, detail }] }
 */
export function verdictCard(result) {
  const counts = result.counts || {};
  return {
    verdict: result.verdict,
    target: result.url,
    checkedAt: result.checkedAt,
    counts: [
      { key: "paid", value: count(counts.paid), label: "paid calls (vet402)" },
      { key: "delivered", value: count(counts.delivered), label: "came back with content" },
      { key: "validationsPassed", value: count(counts.validationsPassed), label: "validations passed (trusted)" },
    ],
    pillars: PILLARS.map((p) => {
      const r = (result.reasons || []).find((x) => x.pillar === p.key) || { effect: "CAUTION", text: "Not measured.", code: `${p.key}_missing` };
      // Pillar 3 joins two sources; its line is the source that decided the effect.
      const decided = Array.isArray(r.sources) ? r.sources.find((s) => s.effect === r.effect) : null;
      return { key: p.key, title: p.title, hint: p.hint, effect: r.effect, label: label(r.effect), line: oneLine(decided ? decided.text : r.text), detail: r.text, code: r.code };
    }),
  };
}
