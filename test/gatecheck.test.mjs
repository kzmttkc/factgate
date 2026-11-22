// End-to-end check of one counterparty with a fake network (no real requests): the three
// pillars, the order of the identity check, the verdict and the AgentFacts output.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SELECTORS } from "../site/js/chain.mjs";
import { gateCheck, summarizeCheck } from "../site/js/gatecheck.mjs";

const PAYEE = "0xabf4fabd7c416fb67202e5f9002389fc75e2a9d0";
const WORD = (a) => `0x${"0".repeat(24)}${a.slice(2)}`;
const STR = (s) => {
  const hex = Buffer.from(s).toString("hex");
  return `0x${"20".padStart(64, "0")}${s.length.toString(16).padStart(64, "0")}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
};
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

function fakeNet(routes, rpc) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || "GET", body: init.body });
    if (rpc && rpc[url]) {
      const body = JSON.parse(init.body);
      return json({ jsonrpc: "2.0", id: 1, ...rpc[url](body.params[0].data.slice(0, 10), body.params[0].to) });
    }
    const r = routes[url];
    if (!r) {
      return new Response("not found", { status: 404 });
    }
    if (r instanceof Error) {
      throw r;
    }
    return typeof r === "function" ? r(init) : r.clone();
  };
  return { fetchImpl, seen };
}

const V2 = { x402Version: 2, resource: { url: "https://seller.example/api/w" }, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0" }] };
const OFFICIAL_MAIN = "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

async function sellerNet({ owner = PAYEE, wallet = PAYEE } = {}) {
  const vet = JSON.parse(await readFile(new URL("./fixtures/vet402_check_x402_seller_allow.json", import.meta.url), "utf8"));
  return fakeNet(
    {
      "https://seller.example/api/w": json({ error: "Payment required" }, 402, { "payment-required": Buffer.from(JSON.stringify(V2)).toString("base64") }),
      "https://seller.example/.well-known/agent-registration.json": json({ name: "Seller", services: [{ name: "MCP", endpoint: "https://seller.example/mcp" }], registrations: [{ agentId: 94639, agentRegistry: OFFICIAL_MAIN }] }),
      "https://seller.example/mcp": (init) => {
        const b = JSON.parse(init.body);
        if (b.method === "initialize") {
          return json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } });
        }
        return json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "catalog.search" }] } });
      },
      "https://vet402.com/mcp": json(vet),
    },
    {
      "https://mainnet.base.org": (sel) => {
        if (sel === SELECTORS.ownerOf) {
          return { result: WORD(owner) };
        }
        if (sel === SELECTORS.getAgentWallet) {
          return { result: WORD(wallet) };
        }
        return { result: STR("https://seller.example/.well-known/agent-registration.json") };
      },
    },
  );
}

test("a seller whose 402, declared registration, chain record and vet402 record agree is ALLOW", async () => {
  const { fetchImpl, seen } = await sellerNet();
  const r = await gateCheck({ url: "https://seller.example/api/w" }, { fetch: fetchImpl, now: () => "2026-11-22T00:00:00.000Z" });
  assert.equal(r.verdict, "ALLOW", JSON.stringify(r.reasons));
  assert.deepEqual(r.reasons.map((x) => x.code), ["live_as_declared", "identity_match", "delivery_delivered"]);
  assert.equal(r.evidence.identity.agent.agentId, "94639");
  assert.equal(r.evidence.identity.binding.bound, true);
  assert.equal(r.agentFacts.id, "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:94639");
  assert.equal(r.agentFacts.x_factgate_verdict.verdict, "ALLOW");
  // Read-only: RPC requests are eth_call only, and nothing is posted to the seller except MCP reads.
  for (const s of seen.filter((x) => x.url === "https://mainnet.base.org")) {
    assert.equal(JSON.parse(s.body).method, "eth_call");
  }
  for (const s of seen.filter((x) => x.url.startsWith("https://seller.example") && x.method === "POST")) {
    assert.ok(["initialize", "tools/list", "notifications/initialized"].includes(JSON.parse(s.body).method));
  }
  const sum = summarizeCheck(r);
  assert.equal(sum.identity.owner, PAYEE);
  assert.equal(sum.delivery.recommendation, "ALLOW");
});

test("the same seller with a chain owner and wallet that differ from its payTo is BLOCK", async () => {
  const { fetchImpl } = await sellerNet({ owner: "0x9999999999999999999999999999999999999999", wallet: "0x9999999999999999999999999999999999999999" });
  const r = await gateCheck({ url: "https://seller.example/api/w" }, { fetch: fetchImpl });
  assert.equal(r.verdict, "BLOCK");
  assert.equal(r.reasons[1].code, "identity_payee_mismatch");
});

// Shaped after ~/factgate-peers (Glossy Stay / Verified Stay): manifest trust block, a declared
// quote standing in for a 402, a registration file that is not on chain.
function staySite(port, { name, payTo, wallet, bookBody, mcp, registry = "eip155:84532:0x5555555555555555555555555555555555555555" }) {
  const base = `http://127.0.0.1:${port}`;
  const routes = {
    [`${base}/agent-manifest.json`]: json({
      networks: [{ name, front_man: "desk", hocon: `./${name}.network.json`, sample_queries: ["q"] }],
      llm_router: {},
      peer_policy: {},
      trust: { identity: { registration: "./.well-known/agent-registration.json", agentWallet: `eip155:84532:${wallet}` }, payments: { quote: "./pay/quote.json", resource: "./api/book.json" }, ...(mcp ? { mcp: { url: mcp, tools: ["get_guest_reviews"] } } : {}) },
    }),
    [`${base}/${name}.network.json`]: json({ tools: [{ name: "desk", tools: ["policy"] }, { name: "policy", tools: mcp ? [{ url: mcp, tools: ["get_guest_reviews"] }] : [] }] }),
    [`${base}/.well-known/agent-registration.json`]: json({ name: "Stay", agentWallet: wallet, services: mcp ? [{ name: "MCP", endpoint: mcp }] : [], registrations: [{ agentId: 9101, agentRegistry: registry }] }),
    [`${base}/pay/quote.json`]: json({ simulatedHttpStatus: 402, x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", maxAmountRequired: "180000000", payTo, asset: "0x4444444444444444444444444444444444444444", resource: `${base}/api/book.json` }] }),
    [`${base}/api/book.json`]: new Response(bookBody, { status: 200, headers: { "content-type": "application/json" } }),
  };
  if (mcp) {
    routes[mcp] = new TypeError("fetch failed: getaddrinfo ENOTFOUND");
  }
  return routes;
}

test("Glossy Stay shape: payTo outside its declared wallet and an empty booking body give BLOCK", async () => {
  const { fetchImpl } = fakeNet(staySite(8791, { name: "glossy_stay", payTo: "0x2222222222222222222222222222222222222222", wallet: "0x1111111111111111111111111111111111111111", bookBody: "", mcp: "https://mcp.glossy-stay.invalid/mcp" }));
  const r = await gateCheck({ url: "http://127.0.0.1:8791/glossy_stay" }, { fetch: fetchImpl });
  assert.equal(r.verdict, "BLOCK");
  assert.equal(r.reasons[0].code, "live_not_as_declared");
  assert.match(r.reasons[0].text, /0x2222/);
  assert.match(r.reasons[0].text, /empty body/);
  assert.equal(r.reasons[1].code, "identity_declared_only");
  assert.deepEqual(r.evidence.live.checks.manifest.problems, []);
  assert.equal(r.evidence.live.checks.mcp[0].state, "unreachable");
  assert.equal(r.evidence.live.declared.termsSource, "declared quote (simulated 402)");
});

test("Verified Stay shape: everything it declares matches, but a registration only declared is not ALLOW", async () => {
  const { fetchImpl } = fakeNet(staySite(8792, { name: "verified_stay", payTo: "0x3333333333333333333333333333333333333333", wallet: "0x3333333333333333333333333333333333333333", bookBody: '{"status":"confirmed"}' }));
  const r = await gateCheck({ url: "http://127.0.0.1:8792/verified_stay" }, { fetch: fetchImpl });
  assert.equal(r.reasons[0].code, "live_as_declared", r.reasons[0].text);
  assert.equal(r.reasons[1].code, "identity_declared_only");
  assert.equal(r.verdict, "CAUTION");
});

test("Verified Stay shape once registered on Base Sepolia: the chain record is read and matched", async () => {
  const routes = staySite(8792, { name: "verified_stay", payTo: "0x3333333333333333333333333333333333333333", wallet: "0x3333333333333333333333333333333333333333", bookBody: '{"status":"confirmed"}', registry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e" });
  const { fetchImpl, seen } = fakeNet(routes, {
    "https://sepolia.base.org": (sel, to) => {
      assert.equal(to, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
      if (sel === SELECTORS.tokenURI) {
        return { result: STR("http://127.0.0.1:8792/.well-known/agent-registration.json") };
      }
      return { result: WORD("0x3333333333333333333333333333333333333333") };
    },
  });
  const r = await gateCheck({ url: "http://127.0.0.1:8792/verified_stay" }, { fetch: fetchImpl });
  assert.equal(r.reasons[1].code, "identity_match");
  assert.ok(seen.some((s) => s.url === "https://sepolia.base.org"));
  // Pillar 3 stays unmeasured: vet402 has no record for a loopback demo site.
  assert.equal(r.reasons[2].code, "delivery_unavailable");
});

test("a visitor-chosen agentId and chain override the declared registration", async () => {
  const { fetchImpl, seen } = await sellerNet();
  await gateCheck({ url: "https://seller.example/api/w", agentId: "10798", chainId: 84532 }, { fetch: fetchImpl, skipDelivery: true });
  assert.ok(seen.some((s) => s.url === "https://sepolia.base.org"));
  assert.ok(!seen.some((s) => s.url === "https://mainnet.base.org"));
});

test("a counterparty the browser cannot reach at all is CAUTION with corsReachable false", async () => {
  const { fetchImpl } = fakeNet({}, null);
  const unreachable = async () => {
    throw new TypeError("Failed to fetch");
  };
  const r = await gateCheck({ url: "https://closed.example/" }, { fetch: unreachable });
  assert.equal(r.verdict, "CAUTION");
  assert.equal(r.reasons[0].code, "live_cors_unreachable");
  assert.ok(fetchImpl);
});
