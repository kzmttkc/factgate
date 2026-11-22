// Tests for pillar 1 (live probe): the pure parts that read what a counterparty declares and
// compare it with what it answers. Offline.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkToolsList,
  compareDeclaredWallets,
  declaredWallets,
  declaredTrust,
  inspectManifest,
  inspectNetwork,
  liveFromChecks,
  networkRef,
  parseDeclaredQuote,
  parsePaymentRequired,
  parseRpcBody,
  resourceCheck,
} from "../site/js/probe.mjs";

test("networkRef follows spec 3.2: the last path part is the network name, the rest the site base", () => {
  assert.deepEqual(networkRef("https://agent-atlas-phi.vercel.app/agent_atlas"), {
    base: "https://agent-atlas-phi.vercel.app/",
    name: "agent_atlas",
    manifestUrl: "https://agent-atlas-phi.vercel.app/agent-manifest.json",
  });
  assert.equal(networkRef("https://ledenti.github.io/trois-nombres/three_numbers.network.json").name, "three_numbers");
  assert.equal(networkRef("https://ledenti.github.io/trois-nombres/three_numbers.network.json").manifestUrl, "https://ledenti.github.io/trois-nombres/agent-manifest.json");
  assert.deepEqual(networkRef("https://shutdown-clerk.pages.dev/"), {
    base: "https://shutdown-clerk.pages.dev/",
    name: null,
    manifestUrl: "https://shutdown-clerk.pages.dev/agent-manifest.json",
  });
  assert.equal(networkRef("not a url"), null);
  assert.equal(networkRef("ftp://x.example/a"), null);
});

const MANIFEST = {
  networks: [{ name: "agent_atlas", front_man: "atlas", hocon: "./agent_atlas.network.json", sample_queries: ["a", "b"] }],
  llm_router: { base_url: "https://api.otari.ai/api/v1" },
  peer_policy: { mode: "closed" },
};

test("inspectManifest picks the exact network and resolves nothing it was not asked for", () => {
  const r = inspectManifest(MANIFEST, "agent_atlas");
  assert.equal(r.ok, true);
  assert.equal(r.entry.front_man, "atlas");
  assert.deepEqual(r.problems, []);
  const wrong = inspectManifest(MANIFEST, "other");
  assert.equal(wrong.ok, false);
  assert.match(wrong.problems[0], /no network named "other"/);
});

test("inspectManifest with no name takes the only network, and flags missing required fields", () => {
  assert.equal(inspectManifest(MANIFEST, null).entry.name, "agent_atlas");
  const bad = inspectManifest({ networks: [{ name: "x", hocon: "./x.json" }] }, "x");
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /front_man/.test(p)));
  assert.ok(bad.warnings.some((w) => /sample_queries/.test(w)));
  assert.ok(bad.warnings.some((w) => /llm_router/.test(w)));
  assert.equal(inspectManifest(null, null).ok, false);
  assert.equal(inspectManifest({ networks: [] }, null).ok, false);
});

const NETWORK = {
  metadata: { description: "d", sample_queries: ["q1"] },
  tools: [
    { name: "atlas", function: { description: "front" }, instructions: "i", tools: ["helper", "https://peer.example/net"] },
    { name: "helper", function: { description: "h" }, instructions: "i", tools: [{ url: "https://agent-atlas-phi.vercel.app/api/mcp", tools: ["search_directory", "check_site"] }] },
  ],
};

test("inspectNetwork collects declared MCP servers and peers, and checks the front agent", () => {
  const r = inspectNetwork(NETWORK, "atlas");
  assert.equal(r.ok, true);
  assert.equal(r.agents, 2);
  assert.deepEqual(r.mcp, [{ url: "https://agent-atlas-phi.vercel.app/api/mcp", tools: ["search_directory", "check_site"] }]);
  assert.deepEqual(r.peers, ["https://peer.example/net"]);
  assert.equal(r.sampleQueries, 1);
});

test("inspectNetwork flags a missing front agent, a dangling reference and duplicate names", () => {
  const r = inspectNetwork({ tools: [{ name: "a", tools: ["ghost"] }, { name: "a" }] }, "front");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /front agent "front"/.test(p)));
  assert.ok(r.problems.some((p) => /"ghost"/.test(p)));
  assert.ok(r.problems.some((p) => /duplicate/.test(p)));
  assert.equal(inspectNetwork({}, "a").ok, false);
});

const V2_TERMS = {
  x402Version: 2,
  resource: { url: "https://agent402.tools/api/weather-forecast" },
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0" },
  ],
};

test("parsePaymentRequired reads v2 terms from the PAYMENT-REQUIRED header", () => {
  const header = Buffer.from(JSON.stringify(V2_TERMS)).toString("base64");
  const r = parsePaymentRequired({ status: 402, header, bodyText: "" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "header");
  assert.equal(r.terms.accepts[0].payTo, "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0");
  assert.equal(r.terms.accepts[0].amount, "1000");
  assert.equal(r.terms.accepts[0].network, "eip155:8453");
});

test("parsePaymentRequired reads v1 terms from the body and maps maxAmountRequired", () => {
  const body = JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "5000", payTo: "0x1111111111111111111111111111111111111111", asset: "0xa" }] });
  const r = parsePaymentRequired({ status: 402, header: null, bodyText: body });
  assert.equal(r.ok, true);
  assert.equal(r.source, "body");
  assert.equal(r.terms.accepts[0].amount, "5000");
});

test("parsePaymentRequired: a 402 with no usable terms is a problem; a 200 is not a payment answer", () => {
  const r = parsePaymentRequired({ status: 402, header: null, bodyText: "<html>pay</html>" });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length > 0);
  const noPayTo = parsePaymentRequired({ status: 402, header: null, bodyText: JSON.stringify({ accepts: [{ network: "base", amount: "1" }] }) });
  assert.equal(noPayTo.ok, false);
  assert.ok(noPayTo.problems.some((p) => /payTo/.test(p)));
  assert.equal(parsePaymentRequired({ status: 200, header: null, bodyText: "{}" }), null);
});

test("parseRpcBody reads plain JSON and server-sent events", () => {
  assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{}}'), { jsonrpc: "2.0", id: 1, result: {} });
  assert.deepEqual(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n').id, 2);
  assert.equal(parseRpcBody("nope"), null);
});

test("checkToolsList names the declared tools the server does not list", () => {
  const rpc = { result: { tools: [{ name: "search_directory" }, { name: "list_sites" }] } };
  const r = checkToolsList(rpc, ["search_directory", "check_site"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["check_site"]);
  assert.deepEqual(r.listed, ["search_directory", "list_sites"]);
  assert.equal(checkToolsList(rpc, []).ok, true);
  assert.equal(checkToolsList({ error: { code: -32601, message: "x" } }, ["a"]).ok, false);
  assert.equal(checkToolsList(null, ["a"]).ok, false);
});

test("liveFromChecks: everything declared answers as declared gives yes", () => {
  const p = liveFromChecks({
    target: { reachable: true, status: 402 },
    manifest: { state: "absent" },
    registration: { state: "found" },
    payment: { state: "terms", problems: [] },
    mcp: [{ url: "https://agent402.tools/mcp", state: "ok", missing: [] }],
  });
  assert.equal(p.status, "ok");
  assert.equal(p.data.corsReachable, true);
  assert.equal(p.data.answersAsDeclared, true);
  assert.deepEqual(p.data.unreachable, []);
});

test("liveFromChecks: nothing reachable over CORS gives corsReachable false", () => {
  const p = liveFromChecks({ target: { reachable: false, error: "TypeError" }, manifest: { state: "unreachable", error: "TypeError" }, registration: { state: "unreachable" }, mcp: [] });
  assert.equal(p.data.corsReachable, false);
});

test("liveFromChecks: a declared tool missing from tools/list is a mismatch", () => {
  const p = liveFromChecks({
    target: { reachable: false },
    manifest: { state: "found", problems: [] },
    network: { state: "found", problems: [] },
    mcp: [{ url: "https://x.example/mcp", state: "ok", missing: ["check_site"] }],
  });
  assert.equal(p.data.answersAsDeclared, false);
  assert.match(p.data.detail, /check_site/);
});

test("liveFromChecks: a declared MCP the browser cannot reach is listed as unreachable, not as a mismatch", () => {
  const p = liveFromChecks({
    target: { reachable: false },
    manifest: { state: "found", problems: [] },
    network: { state: "found", problems: [] },
    mcp: [{ url: "https://x.example/mcp", state: "unreachable", error: "TypeError: Failed to fetch" }],
  });
  assert.equal(p.data.answersAsDeclared, true);
  assert.equal(p.data.unreachable.length, 1);
});

test("liveFromChecks: a 402 without usable terms or a broken manifest is a mismatch", () => {
  assert.equal(liveFromChecks({ target: { reachable: true, status: 402 }, manifest: { state: "absent" }, payment: { state: "unreadable", problems: ["no accepts"] }, mcp: [] }).data.answersAsDeclared, false);
  assert.equal(liveFromChecks({ target: { reachable: true }, manifest: { state: "found", problems: ["no front_man"] }, mcp: [] }).data.answersAsDeclared, false);
});

test("liveFromChecks: reachable but nothing declared is not compared", () => {
  const p = liveFromChecks({ target: { reachable: true, status: 200 }, manifest: { state: "absent" }, registration: { state: "absent" }, mcp: [] });
  assert.equal(p.data.corsReachable, true);
  assert.equal(p.data.answersAsDeclared, null);
});

// ---- Declarations the demo peers use (~/factgate-peers): a manifest trust block, a declared
// quote that stands in for a 402, and wallets named in the registration file. ----

const GLOSSY_TRUST = {
  identity: { standard: "ERC-8004", registration: "./.well-known/agent-registration.json", agentWallet: "eip155:84532:0x1111111111111111111111111111111111111111" },
  payments: { protocol: "x402", quote: "./pay/quote.json", resource: "./api/book.json" },
  mcp: { url: "https://mcp.glossy-stay.invalid/mcp", tools: ["get_guest_reviews"] },
};

test("declaredTrust resolves a manifest trust block against the site base", () => {
  const t = declaredTrust({ trust: GLOSSY_TRUST }, "http://127.0.0.1:8791/");
  assert.equal(t.quoteUrl, "http://127.0.0.1:8791/pay/quote.json");
  assert.equal(t.resourceUrl, "http://127.0.0.1:8791/api/book.json");
  assert.equal(t.registrationUrl, "http://127.0.0.1:8791/.well-known/agent-registration.json");
  assert.deepEqual(t.mcp, [{ url: "https://mcp.glossy-stay.invalid/mcp", tools: ["get_guest_reviews"] }]);
  assert.deepEqual(t.wallets, ["0x1111111111111111111111111111111111111111"]);
  assert.deepEqual(declaredTrust({}, "http://x/"), { quoteUrl: null, resourceUrl: null, registrationUrl: null, mcp: [], wallets: [] });
});

test("parseDeclaredQuote reads a declared quote that stands in for a 402 and marks it simulated", () => {
  const q = { simulatedHttpStatus: 402, x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", maxAmountRequired: "180000000", payTo: "0x2222222222222222222222222222222222222222", asset: "0x4444444444444444444444444444444444444444" }] };
  const r = parseDeclaredQuote(q);
  assert.equal(r.ok, true);
  assert.equal(r.simulated, true);
  assert.equal(r.terms.accepts[0].payTo, "0x2222222222222222222222222222222222222222");
  assert.equal(parseDeclaredQuote({ hello: 1 }).ok, false);
});

test("declaredWallets reads agentWallet and wallet services (CAIP-10) from a registration file", () => {
  const w = declaredWallets({
    agentWallet: "0x1111111111111111111111111111111111111111",
    services: [{ name: "agentWallet", endpoint: "eip155:84532:0x1111111111111111111111111111111111111111" }, { name: "wallet", endpoint: "eip155:42220:0xc9c7b38C0942914fC8EA12063BC92dcd3b581670" }, { name: "web", endpoint: "https://x/" }],
  });
  assert.deepEqual(w, ["0x1111111111111111111111111111111111111111", "0xc9c7b38c0942914fc8ea12063bc92dcd3b581670"]);
  assert.deepEqual(declaredWallets(null), []);
});

test("compareDeclaredWallets: a payTo outside the declared wallets is a mismatch", () => {
  const terms = { accepts: [{ network: "base-sepolia", payTo: "0x2222222222222222222222222222222222222222" }] };
  const r = compareDeclaredWallets(["0x1111111111111111111111111111111111111111"], terms);
  assert.equal(r.state, "mismatch");
  assert.match(r.detail, /0x2222/);
  assert.equal(compareDeclaredWallets(["0x2222222222222222222222222222222222222222"], terms).state, "match");
  assert.equal(compareDeclaredWallets([], terms).state, "not_compared");
  assert.equal(compareDeclaredWallets(["0x1111111111111111111111111111111111111111"], null).state, "not_compared");
});

test("resourceCheck: an empty 200 from the declared paid resource is a mismatch; a 402 or a body is fine", () => {
  assert.equal(resourceCheck({ status: 200, bodyText: "" }).state, "empty");
  assert.equal(resourceCheck({ status: 200, bodyText: "   " }).state, "empty");
  assert.equal(resourceCheck({ status: 402, bodyText: "" }).state, "ok");
  assert.equal(resourceCheck({ status: 200, bodyText: '{"status":"confirmed"}' }).state, "ok");
  assert.equal(resourceCheck({ status: 500, bodyText: "x" }).state, "error");
});

test("liveFromChecks: a declared wallet that the 402 does not pay, or an empty paid resource, is a mismatch", () => {
  const base = { target: { reachable: false }, manifest: { state: "found", problems: [] }, network: { state: "found", problems: [] }, mcp: [] };
  const w = liveFromChecks({ ...base, wallets: { state: "mismatch", detail: "payTo 0x2222 is not a declared wallet" } });
  assert.equal(w.data.answersAsDeclared, false);
  assert.match(w.data.detail, /0x2222/);
  const e = liveFromChecks({ ...base, resource: { state: "empty", url: "http://127.0.0.1:8791/api/book.json", status: 200 } });
  assert.equal(e.data.answersAsDeclared, false);
  assert.match(e.data.detail, /empty/);
  const u = liveFromChecks({ ...base, resource: { state: "unreachable", url: "http://x/api", error: "TypeError" } });
  assert.equal(u.data.answersAsDeclared, true);
  assert.equal(u.data.unreachable.length, 1);
});

test("a name in link_slots is a named peer reference (spec 3.3 links.json), not a missing agent", async () => {
  const { inspectNetwork } = await import("../site/js/probe.mjs");
  const r = inspectNetwork({ link_slots: { factgate: { callers: ["desk"] } }, tools: [{ name: "desk", tools: ["factgate", "ghost"] }] }, "desk");
  assert.deepEqual(r.peers, ["link:factgate"]);
  assert.deepEqual(r.problems, ['agent "desk" calls "ghost", which is not an agent in the network']);
});
