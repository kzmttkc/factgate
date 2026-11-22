// A redirect to another origin is a new destination (MVP spec section 5, "Consent before
// contact"): FactGate must not follow it until the visitor approves that origin on a card.
// Two real HTTP servers on two ports (two origins); the first answers 302 to the second.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { withConsent } from "../site/js/consent.mjs";
import { gateCheck } from "../site/js/gatecheck.mjs";
import { timedFetch } from "../site/js/net.mjs";

function listen(handler) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, hits, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function pair() {
  const b = await listen((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ networks: [{ name: "elsewhere" }] }));
  });
  const a = await listen((req, res) => {
    res.writeHead(302, { Location: `${b.origin}${req.url}`, "Access-Control-Allow-Origin": "*" });
    res.end();
  });
  return { a, b, close: () => Promise.all([a, b].map((s) => new Promise((r) => s.server.close(r)))) };
}

test("redirect: a 302 to another origin is not followed until that origin is approved; declined, it gets no request", async () => {
  const { a, b, close } = await pair();
  try {
    const cards = [];
    const { result, consent } = await withConsent((f) => timedFetch(f, `${a.origin}/agent-manifest.json`), {
      fetch: globalThis.fetch,
      // The first card (the first origin) is approved; any later card is declined.
      ask: async (request) => {
        cards.push(request.rows.map((r) => r.origin));
        return cards.length === 1 ? "once" : "decline";
      },
    });
    assert.deepEqual(b.hits, [], "the second origin was contacted without the visitor's approval");
    assert.deepEqual(cards, [[a.origin], [b.origin]], "the redirect target did not get its own card");
    assert.equal(result.ok, false);
    assert.match(result.error, /declined/);
    assert.deepEqual(consent.declined, [b.origin]);
    assert.equal(a.hits.length, 1);
  } finally {
    await close();
  }
});

test("redirect: approved on its own card, the new origin is contacted only after that card", async () => {
  const { a, b, close } = await pair();
  try {
    const hitsAtCard = [];
    const { result } = await withConsent((f) => timedFetch(f, `${a.origin}/agent-manifest.json`), {
      fetch: globalThis.fetch,
      ask: async (request) => {
        hitsAtCard.push(b.hits.length);
        return "once";
      },
    });
    assert.deepEqual(hitsAtCard, [0, 0]);
    assert.equal(result.ok, true);
    assert.equal(result.response.status, 200);
    assert.deepEqual(b.hits, ["/agent-manifest.json"]);
  } finally {
    await close();
  }
});

test("redirect: a full check whose manifest redirects to another origin sends that origin nothing when it is declined", async () => {
  const { a, b, close } = await pair();
  try {
    const r = await gateCheck({ url: `${a.origin}/some_network` }, {
      fetch: globalThis.fetch,
      timeoutMs: 3000,
      ask: async (request) => ({ decisions: Object.fromEntries(request.rows.map((x) => [x.origin, x.origin === a.origin ? "once" : "decline"])) }),
    });
    assert.deepEqual(b.hits, []);
    assert.ok(r.consent.declined.includes(b.origin), JSON.stringify(r.consent));
    assert.notEqual(r.verdict, "ALLOW");
  } finally {
    await close();
  }
});

test("redirect: a browser's opaque redirect (Location hidden) is not followed and says so", async () => {
  const opaque = { type: "opaqueredirect", status: 0, statusText: "", headers: new Headers(), text: async () => "" };
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push([String(url), init.redirect]);
    return opaque;
  };
  const { result } = await withConsent((f) => timedFetch(f, "https://a.example/x"), { fetch: fetchImpl, ask: async () => "once" });
  assert.deepEqual(sent, [["https://a.example/x", "manual"]]);
  assert.equal(result.ok, false);
  assert.match(result.error, /redirect/i);
});
