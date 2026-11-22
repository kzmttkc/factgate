// Tests for pillar 2 (identity): ERC-8004 call encoding, result decoding, binding and the pillar.
// Offline. Selector values are checked against a Keccak-256 written for the tests.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAINS,
  IDENTITY_REGISTRY,
  SELECTORS,
  bindingOf,
  decodeAddress,
  decodeDataUriJson,
  decodeString,
  encodeUintCall,
  evmPayTos,
  identityPillar,
  parseAgentRegistry,
  pickRegistration,
  readAgent,
} from "../site/js/chain.mjs";
import { keccak256, selector } from "../scripts/keccak256.mjs";

const PAYEE = "0xabf4fabd7c416fb67202e5f9002389fc75e2a9d0";
const WORD = (addr) => `0x${"0".repeat(24)}${addr.slice(2)}`;

test("keccak256 matches the known empty-string digest", () => {
  assert.equal(keccak256(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(selector("transfer(address,uint256)"), "0xa9059cbb");
});

test("selectors are keccak256 of the IdentityRegistry signatures", () => {
  assert.equal(SELECTORS.ownerOf, selector("ownerOf(uint256)"));
  assert.equal(SELECTORS.getAgentWallet, selector("getAgentWallet(uint256)"));
  assert.equal(SELECTORS.tokenURI, selector("tokenURI(uint256)"));
});

test("registry addresses are the ones in erc-8004/erc-8004-contracts README", () => {
  assert.equal(IDENTITY_REGISTRY.mainnet, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
  assert.equal(IDENTITY_REGISTRY.testnet, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
  assert.equal(CHAINS[8453].registry, IDENTITY_REGISTRY.mainnet);
  assert.equal(CHAINS[84532].registry, IDENTITY_REGISTRY.testnet);
  assert.equal(CHAINS[8453].rpc, "https://mainnet.base.org");
  assert.equal(CHAINS[84532].rpc, "https://sepolia.base.org");
});

test("encodeUintCall pads the agentId to 32 bytes and refuses bad ids", () => {
  assert.equal(encodeUintCall(SELECTORS.ownerOf, 94639), `0x6352211e${(94639).toString(16).padStart(64, "0")}`);
  assert.equal(encodeUintCall(SELECTORS.ownerOf, "10798"), `0x6352211e${(10798).toString(16).padStart(64, "0")}`);
  assert.throws(() => encodeUintCall(SELECTORS.ownerOf, -1));
  assert.throws(() => encodeUintCall(SELECTORS.ownerOf, "1e3"));
  assert.throws(() => encodeUintCall(SELECTORS.ownerOf, 1.5));
});

test("decodeAddress reads a 32-byte word and rejects dirty or empty results", () => {
  assert.equal(decodeAddress(WORD(PAYEE)), PAYEE);
  assert.equal(decodeAddress("0x"), null);
  assert.equal(decodeAddress(`0x${"1".repeat(64)}`), null);
});

test("decodeString reads an ABI string and returns null for an empty result", () => {
  const s = "https://agent402.tools/.well-known/agent-registration.json";
  const hex = Buffer.from(s, "utf8").toString("hex");
  const len = s.length.toString(16).padStart(64, "0");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  assert.equal(decodeString(`0x${"20".padStart(64, "0")}${len}${padded}`), s);
  assert.equal(decodeString("0x"), null);
});

test("parseAgentRegistry splits a CAIP-10 style registry string", () => {
  assert.deepEqual(parseAgentRegistry("eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"), {
    namespace: "eip155",
    chainId: 8453,
    address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  });
  assert.equal(parseAgentRegistry("solana:abc:xyz"), null);
  assert.equal(parseAgentRegistry(42), null);
});

test("pickRegistration takes the first official registry on a supported chain and names the rest", () => {
  const picked = pickRegistration({
    registrations: [
      { agentId: 194, agentRegistry: "eip155:42220:0xaC3DF9ABf80d0F5c020C06B04Cced27763355944" },
      { agentId: 94639, agentRegistry: "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
    ],
  });
  assert.deepEqual(picked.chosen, { chainId: 8453, agentId: "94639" });
  assert.equal(picked.skipped.length, 0);
  assert.equal(picked.unofficial.length, 1);
  assert.match(picked.unofficial[0].note, /not the official ERC-8004 IdentityRegistry/);
  assert.equal(pickRegistration(null).chosen, null);
  const other = pickRegistration({ registrations: [{ agentId: 1, agentRegistry: "eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }] });
  assert.match(other.skipped[0], /chain 1 is not one FactGate reads/);
});

test("decodeDataUriJson reads base64 and plain JSON data URIs", () => {
  const obj = { name: "ClawNews" };
  assert.deepEqual(decodeDataUriJson(`data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`), obj);
  assert.deepEqual(decodeDataUriJson(`data:application/json,${encodeURIComponent(JSON.stringify(obj))}`), obj);
  assert.equal(decodeDataUriJson("https://x.example/a.json"), null);
  assert.equal(decodeDataUriJson("data:application/json;base64,!!!"), null);
});

test("evmPayTos keeps EVM payees with their chain and leaves non-EVM ones out", () => {
  const terms = {
    accepts: [
      { network: "eip155:8453", payTo: "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0" },
      { network: "base", payTo: "0xaBF4FAbd7c416fB67202E5f9002389Fc75e2a9D0" },
      { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg" },
    ],
  };
  const out = evmPayTos(terms);
  assert.equal(out.compared.length, 2);
  assert.equal(out.compared[0].payTo, PAYEE);
  assert.equal(out.compared[0].chainId, 8453);
  assert.equal(out.compared[1].chainId, 8453);
  assert.equal(out.notCompared.length, 1);
  assert.deepEqual(evmPayTos(null), { compared: [], notCompared: [] });
});

test("bindingOf: the target's own well-known file that lists the agent binds it", () => {
  const b = bindingOf({
    targetUrl: "https://agent402.tools/api/weather-forecast",
    chainId: 8453,
    agentId: "94639",
    wellKnown: { registrations: [{ agentId: 94639, agentRegistry: "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }] },
  });
  assert.equal(b.bound, true);
  assert.match(b.how, /well-known/);
});

test("bindingOf: an agentURI on the target's origin binds it; a stranger's agent does not", () => {
  assert.equal(bindingOf({ targetUrl: "https://a.example/x", chainId: 8453, agentId: "1", tokenURI: "https://a.example/reg.json" }).bound, true);
  const stranger = bindingOf({ targetUrl: "https://a.example/x", chainId: 8453, agentId: "1", tokenURI: "https://b.example/reg.json", registrationFile: { services: [{ name: "web", endpoint: "https://b.example/" }] } });
  assert.equal(stranger.bound, false);
});

test("bindingOf: a registration file whose service endpoint is on the target's origin binds it", () => {
  const b = bindingOf({ targetUrl: "https://a.example/api", chainId: 8453, agentId: "1", tokenURI: "ipfs://cid", registrationFile: { services: [{ name: "MCP", endpoint: "https://a.example/mcp" }] } });
  assert.equal(b.bound, true);
});

test("identityPillar: payee equal to the on-chain agentWallet is a match", () => {
  const p = identityPillar({
    payTos: { compared: [{ network: "eip155:8453", chainId: 8453, payTo: PAYEE }], notCompared: [] },
    chainRead: { ok: true, exists: true, owner: PAYEE, agentWallet: PAYEE },
    binding: { bound: true, how: "x" },
  });
  assert.equal(p.status, "ok");
  assert.equal(p.data.declaredPayTo, PAYEE);
  assert.deepEqual(p.data.declaredPayTos, [PAYEE]);
  assert.equal(p.data.registered.owner, PAYEE);
  assert.equal(p.data.registered.bound, true);
});

test("identityPillar: a zero agentWallet is dropped, not compared", () => {
  const p = identityPillar({
    payTos: { compared: [{ chainId: 8453, payTo: PAYEE }], notCompared: [] },
    chainRead: { ok: true, exists: true, owner: PAYEE, agentWallet: "0x0000000000000000000000000000000000000000" },
    binding: { bound: true },
  });
  assert.equal(p.data.registered.agentWallet, null);
});

test("identityPillar: an RPC failure is unavailable; a missing agent is registered null", () => {
  assert.equal(identityPillar({ payTos: { compared: [], notCompared: [] }, chainRead: { ok: false, error: "timeout" } }).status, "unavailable");
  const none = identityPillar({ payTos: { compared: [{ chainId: 8453, payTo: PAYEE }], notCompared: [] }, chainRead: { ok: true, exists: false } });
  assert.equal(none.status, "ok");
  assert.equal(none.data.registered, null);
});

test("identityPillar: no agent to look up is unavailable with the reason", () => {
  const p = identityPillar({ payTos: { compared: [], notCompared: [] }, chainRead: null, noAgentReason: "no ERC-8004 registration declared" });
  assert.equal(p.status, "unavailable");
  assert.match(p.error, /no ERC-8004 registration declared/);
});

function rpcFake(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "eth_blockNumber") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x3b2e1a0" }), { status: 200 });
    }
    calls.push({ url, data: body.params[0].data, to: body.params[0].to });
    const sel = body.params[0].data.slice(0, 10);
    const a = answers[sel];
    if (a instanceof Error) {
      throw a;
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...a }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("readAgent reads owner, agentWallet and tokenURI with eth_call only", async () => {
  const uri = "https://agent402.tools/.well-known/agent-registration.json";
  const hex = Buffer.from(uri).toString("hex");
  const str = `0x${"20".padStart(64, "0")}${uri.length.toString(16).padStart(64, "0")}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
  const { fetchImpl, calls } = rpcFake({
    [SELECTORS.ownerOf]: { result: WORD(PAYEE) },
    [SELECTORS.getAgentWallet]: { result: WORD(PAYEE) },
    [SELECTORS.tokenURI]: { result: str },
  });
  const r = await readAgent({ chainId: 8453, agentId: "94639" }, fetchImpl);
  assert.equal(r.ok, true);
  assert.equal(r.exists, true);
  assert.equal(r.owner, PAYEE);
  assert.equal(r.tokenURI, uri);
  assert.ok(calls.every((c) => c.url === "https://mainnet.base.org" && c.to === IDENTITY_REGISTRY.mainnet));
  assert.equal(r.rpc.length, 3);
  assert.equal(r.block, 0x3b2e1a0);
  assert.ok(r.rpc.every((x) => x.block === "0x3b2e1a0"));
});

test("readAgent: a revert on ownerOf means the agent does not exist", async () => {
  const { fetchImpl } = rpcFake({
    [SELECTORS.ownerOf]: { error: { code: 3, message: "execution reverted", data: "0x7e273289" } },
    [SELECTORS.getAgentWallet]: { result: WORD("0x0000000000000000000000000000000000000000") },
    [SELECTORS.tokenURI]: { error: { code: 3, message: "execution reverted" } },
  });
  const r = await readAgent({ chainId: 84532, agentId: "99999999" }, fetchImpl);
  assert.equal(r.ok, true);
  assert.equal(r.exists, false);
});

test("readAgent: an empty 0x result (no contract there) is unavailable, not unregistered", async () => {
  const { fetchImpl } = rpcFake({ [SELECTORS.ownerOf]: { result: "0x" }, [SELECTORS.getAgentWallet]: { result: "0x" }, [SELECTORS.tokenURI]: { result: "0x" } });
  const r = await readAgent({ chainId: 8453, agentId: "1" }, fetchImpl);
  assert.equal(r.ok, false);
  assert.match(r.error, /empty/);
});

test("readAgent: an unsupported chain or a network error is unavailable", async () => {
  assert.equal((await readAgent({ chainId: 1, agentId: "1" }, async () => null)).ok, false);
  const { fetchImpl } = rpcFake({ [SELECTORS.ownerOf]: new TypeError("Failed to fetch") });
  const r = await readAgent({ chainId: 8453, agentId: "1" }, fetchImpl);
  assert.equal(r.ok, false);
  assert.match(r.error, /Failed to fetch/);
});

test("pickRegistration: a registration only in an unofficial registry (vet402's Self Agent ID 194) is shown, not judged", () => {
  const picked = pickRegistration({
    registrations: [
      { agentId: 9907, agentRegistry: "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
      { agentId: 194, agentRegistry: "eip155:42220:0xaC3DF9ABf80d0F5c020C06B04Cced27763355944" },
    ],
  });
  assert.deepEqual(picked.chosen, { chainId: 42220, agentId: "9907" });
  assert.deepEqual(picked.skipped, []);
  assert.equal(picked.unofficial[0].agentId, 194);
  const onlyUnofficial = pickRegistration({ registrations: [{ agentId: 194, agentRegistry: "eip155:42220:0xaC3DF9ABf80d0F5c020C06B04Cced27763355944" }] });
  assert.equal(onlyUnofficial.chosen, null);
  assert.equal(onlyUnofficial.skipped.length, 0);
  assert.equal(onlyUnofficial.unofficial.length, 1);
});
