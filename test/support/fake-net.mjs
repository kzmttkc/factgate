// Shared fake network fixtures for gateCheck tests (no real requests).
import { readFile } from "node:fs/promises";
import { IDENTITY_REGISTRY, SELECTORS } from "../../site/js/chain.mjs";
import { VALIDATION_REGISTRY, VALIDATION_SELECTORS, VALIDATION_TOPICS } from "../../site/js/validation.mjs";

export const PAYEE = "0xabf4fabd7c416fb67202e5f9002389fc75e2a9d0";
const JUDGE = "0x5ec4599a438fa0559ade8b8551b369d5c5adf0bc";
const w = (n) => BigInt(n).toString(16).padStart(64, "0");
const WORD = (a) => `0x${"0".repeat(24)}${a.slice(2)}`;
const STR = (s) => {
  const hex = Buffer.from(s).toString("hex");
  return `0x${"20".padStart(64, "0")}${s.length.toString(16).padStart(64, "0")}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
};
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

export function fakeChain({ owner, wallet = owner, uri, validations = [], exists = true }) {
  const hashes = validations.map((_, i) => `0x${(i + 1).toString(16).padStart(64, "0")}`);
  const tsOf = (n) => 1795200000 + Math.floor(n / 5);
  return (body) => {
    const [p0] = body.params;
    if (body.method === "eth_blockNumber") {
      return { result: `0x${(1000000).toString(16)}` };
    }
    if (body.method === "eth_getBlockByNumber") {
      return { result: { timestamp: `0x${tsOf(parseInt(p0, 16)).toString(16)}` } };
    }
    if (body.method === "eth_getLogs") {
      const i = hashes.indexOf(p0.topics[3]);
      const v = validations[i];
      const isResp = p0.topics[0] === VALIDATION_TOPICS.response;
      if (v && (isResp ? v.answered : !v.answered)) {
        return { result: [{ blockNumber: p0.fromBlock, transactionHash: `0x${String(i + 1).repeat(64).slice(0, 64)}`, logIndex: "0x2", data: `0x${w(v.response)}` }] };
      }
      return { result: [] };
    }
    const to = p0.to.toLowerCase();
    const data = p0.data;
    if (to === IDENTITY_REGISTRY.mainnet.toLowerCase() || to === IDENTITY_REGISTRY.testnet.toLowerCase()) {
      if (!exists) {
        return { error: { code: 3, message: "execution reverted" } };
      }
      if (data.startsWith(SELECTORS.ownerOf)) {
        return { result: WORD(owner) };
      }
      if (data.startsWith(SELECTORS.getAgentWallet)) {
        return { result: WORD(wallet) };
      }
      return { result: STR(uri) };
    }
    if (to === VALIDATION_REGISTRY.mainnet.toLowerCase() || to === VALIDATION_REGISTRY.testnet.toLowerCase()) {
      if (data.startsWith(VALIDATION_SELECTORS.getAgentValidations)) {
        return { result: `0x${w(32)}${w(hashes.length)}${hashes.map((h) => h.slice(2)).join("")}` };
      }
      const i = hashes.indexOf(`0x${data.slice(10)}`);
      const v = validations[i];
      return { result: `0x${JUDGE.slice(2).padStart(64, "0")}${w(10798)}${w(v.response)}${"ab".repeat(32)}${w(192)}${w(1795300000 + i)}${w(0)}` };
    }
    return { error: { code: -32000, message: `unexpected call to ${to}` } };
  };
}

export function fakeNet(routes, rpc = {}) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || "GET", body: init.body });
    if (rpc[url]) {
      const body = JSON.parse(init.body);
      if (Array.isArray(body)) {
        return json(body.map((b) => ({ jsonrpc: "2.0", id: b.id, ...rpc[url](b) })));
      }
      return json({ jsonrpc: "2.0", id: 1, ...rpc[url](body) });
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

export async function sellerNet({ owner = PAYEE, wallet = PAYEE, validations = [] } = {}) {
  const vet = JSON.parse(await readFile(new URL("../fixtures/vet402_check_x402_seller_allow.json", import.meta.url), "utf8"));
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
    { "https://mainnet.base.org": fakeChain({ owner, wallet, uri: "https://seller.example/.well-known/agent-registration.json", validations }) },
  );
}

export function freeSite({ siteNamesAgent = true, agentNamesSite = true, network = { tools: [{ name: "a", instructions: "You answer questions about the archive. Never ask for passwords." }] } } = {}) {
  const routes = {
    "https://free.example/agent-manifest.json": json({ networks: [{ name: "free", front_man: "a", hocon: "./free.network.json", sample_queries: ["q"] }], llm_router: {}, peer_policy: {} }),
    "https://free.example/free.network.json": json(network),
    "https://registry-files.example/agent-7.json": json({ name: "Free archive", services: agentNamesSite ? [{ name: "web", endpoint: "https://free.example/free" }] : [{ name: "web", endpoint: "https://elsewhere.example/" }] }),
  };
  if (siteNamesAgent) {
    routes["https://free.example/.well-known/agent-registration.json"] = json({ name: "Free archive", registrations: [{ agentId: 7, agentRegistry: OFFICIAL_MAIN }] });
  }
  return fakeNet(routes, { "https://mainnet.base.org": fakeChain({ owner: PAYEE, uri: "https://registry-files.example/agent-7.json" }) });
}