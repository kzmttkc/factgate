import assert from "node:assert/strict";
import test from "node:test";
import { verdictCard } from "../site/js/card.mjs";
import { gateCheck } from "../site/js/gatecheck.mjs";
import { freeSite, sellerNet } from "./support/fake-net.mjs";

const SELLER = "https://agent402.tools/api/weather-forecast";

function assertDeclinedCard(pillar, hostRe) {
  assert.match(pillar.line, hostRe, `short: ${pillar.line}`);
  assert.match(pillar.detail, hostRe, `Details: ${pillar.detail}`);
  assert.doesNotMatch(pillar.line, /no ERC-8004 registration speaks for it/i);
  assert.doesNotMatch(pillar.detail, /declares no ERC-8004 registration/i);
}

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
  const card = verdictCard(r);
  for (const key of ["live", "identity"]) {
    assertDeclinedCard(card.pillars.find((p) => p.key === key), /declined agent402\.tools/i);
  }
});

test("declined chain RPC: pillar 2 short and Details say you declined the RPC (not missing registration)", async () => {
  const { fetchImpl } = freeSite();
  const r = await gateCheck({ url: "https://free.example/free" }, {
    fetch: fetchImpl,
    ask: async (request) => (request.rows.some((x) => x.host === "mainnet.base.org") ? "decline" : "once"),
  });
  assert.equal(r.reasons[1].code, "identity_unavailable");
  const card = verdictCard(r);
  assertDeclinedCard(card.pillars.find((p) => p.key === "identity"), /declined mainnet\.base\.org/i);
});

test("declined chain RPC on a paid seller: pillar 3 Details include declined RPC, not missing registration", async () => {
  const { fetchImpl } = await sellerNet();
  const r = await gateCheck({ url: "https://seller.example/api/w" }, {
    fetch: fetchImpl,
    ask: async (request) => (request.rows.some((x) => x.host === "mainnet.base.org") ? "decline" : "once"),
  });
  const card = verdictCard(r);
  assertDeclinedCard(card.pillars.find((p) => p.key === "identity"), /declined mainnet\.base\.org/i);
  assert.match(card.pillars.find((p) => p.key === "delivery").detail, /declined mainnet\.base\.org/i);
});

test("declined vet402.com: pillar 3 card text says you declined vet402", async () => {
  const { fetchImpl, seen } = await sellerNet();
  const r = await gateCheck({ url: "https://seller.example/api/w" }, {
    fetch: fetchImpl,
    ask: async (request) => (request.rows.some((x) => x.host === "vet402.com") ? "decline" : "once"),
  });
  assert.ok(!seen.some((x) => x.url === "https://vet402.com/mcp"));
  assert.match(r.reasons[2].text, /declined vet402\.com/i);
  const card = verdictCard(r);
  assertDeclinedCard(card.pillars.find((p) => p.key === "delivery"), /declined vet402\.com/i);
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