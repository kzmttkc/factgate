import assert from "node:assert/strict";
import test from "node:test";
import { gateCheck } from "../site/js/gatecheck.mjs";
import { judgeLive } from "../site/js/gate.mjs";

const SELLER = "https://agent402.tools/api/weather-forecast";

test("declining the counterparty origin says you declined it, not CORS unreachable", async () => {
  const r = await gateCheck(
    { url: SELLER },
    {
      fetch: async () => {
        throw new TypeError("must not fetch");
      },
      ask: async () => "decline",
    },
  );
  assert.equal(r.verdict, "CAUTION");
  assert.match(r.reasons[0].text, /Not checked: you declined agent402\.tools/);
  assert.doesNotMatch(r.reasons[0].text, /cannot reach this counterparty over CORS/i);
  assert.match(r.reasons[1].text, /Not checked: you declined agent402\.tools/);
});

test("supersedeResultBox marks a visible result card", async () => {
  const { supersedeResultBox } = await import("../site/js/app.js");
  const calls = [];
  const box = {
    hidden: false,
    classList: { add: (c) => calls.push(c) },
    dataset: {},
    querySelector: () => null,
    prepend: () => {},
    appendChild: () => {},
  };
  const doc = { createElement: () => ({ className: "", textContent: "" }) };
  assert.equal(supersedeResultBox(box, doc), true);
  assert.ok(calls.includes("result-superseded"));
});