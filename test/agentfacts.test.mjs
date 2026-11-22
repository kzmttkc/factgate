// Tests for the AgentFacts output. Field names follow the paper's appendix
// (arXiv:2507.14263 v1, "Full AgentFacts Schema", V0.3 draft); FactGate's own fields start with x_factgate_.
import assert from "node:assert/strict";
import test from "node:test";
import { AGENTFACTS_FIELDS, buildAgentFacts } from "../site/js/agentfacts.mjs";

const INPUT = {
  url: "https://agent402.tools/api/weather-forecast",
  checkedAt: "2026-11-22T05:00:00.000Z",
  verdict: { verdict: "ALLOW", reasons: [{ pillar: "live", code: "live_as_declared", effect: "ALLOW", text: "t" }] },
  live: {
    pillar: { status: "ok", data: { corsReachable: true, answersAsDeclared: true, unreachable: [] } },
    declared: {
      manifestEntry: null,
      network: null,
      mcp: [{ url: "https://agent402.tools/mcp", tools: [], listed: ["catalog.search"] }],
      terms: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x8335", payTo: "0xabf4" }] },
      registrationFile: { name: "Agent402", description: "Pay-per-call tools", services: [{ name: "MCP", endpoint: "https://agent402.tools/mcp" }] },
    },
    http: [{ url: "https://agent402.tools/api/weather-forecast", method: "GET", status: 402 }],
  },
  identity: {
    pillar: { status: "ok", data: { declaredPayTo: "0xabf4", registered: { owner: "0xabf4", agentWallet: "0xabf4", bound: true } } },
    agent: { chainId: 8453, agentId: "94639", registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
    rpc: [{ url: "https://mainnet.base.org", method: "eth_call ownerOf", ok: true }],
  },
  delivery: { pillar: { status: "ok", data: { recommendation: "ALLOW", record_url: "https://vet402.com/r/1" } } },
};

test("every top-level field is from the paper's schema or an x_factgate_ extension", () => {
  const facts = buildAgentFacts(INPUT);
  for (const key of Object.keys(facts)) {
    assert.ok(AGENTFACTS_FIELDS.includes(key) || key.startsWith("x_factgate_"), `unexpected field ${key}`);
  }
});

test("identity fields come from the ERC-8004 registration when there is one", () => {
  const facts = buildAgentFacts(INPUT);
  assert.equal(facts.id, "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:94639");
  assert.equal(facts.label, "Agent402");
  assert.equal(facts.agent_name, "urn:agent:agent402.tools:Agent402");
  assert.deepEqual(facts.endpoints.static, ["https://agent402.tools/api/weather-forecast", "https://agent402.tools/mcp"]);
});

test("the three pillars and the verdict are carried as evidence under x_factgate_", () => {
  const facts = buildAgentFacts(INPUT);
  assert.equal(facts.x_factgate_verdict.verdict, "ALLOW");
  assert.equal(facts.x_factgate_evidence.live.http[0].status, 402);
  assert.equal(facts.x_factgate_evidence.identity.agent.agentId, "94639");
  assert.equal(facts.x_factgate_evidence.delivery.pillar.data.record_url, "https://vet402.com/r/1");
  assert.equal(facts.evaluations.lastAudited, "2026-11-22T05:00:00.000Z");
  assert.match(facts.evaluations.auditorID, /FactGate/);
});

test("it does not claim a certification or a signature it does not have", () => {
  const facts = buildAgentFacts(INPUT);
  assert.equal(facts.certification, undefined);
  assert.equal(facts.x_factgate_signature.signed, false);
});

test("a target with no registration falls back to the URL and the manifest", () => {
  const facts = buildAgentFacts({
    ...INPUT,
    url: "https://agent-atlas-phi.vercel.app/agent_atlas",
    identity: { pillar: { status: "unavailable", error: "no ERC-8004 registration declared" } },
    live: {
      pillar: { status: "ok", data: { corsReachable: true, answersAsDeclared: true } },
      declared: {
        manifestEntry: { name: "agent_atlas", front_man: "atlas", description: "Directory", sample_queries: ["q"] },
        network: { agents: 1, mcp: [{ url: "https://agent-atlas-phi.vercel.app/api/mcp", tools: ["search_directory"] }] },
        mcp: [{ url: "https://agent-atlas-phi.vercel.app/api/mcp", tools: ["search_directory"], listed: ["search_directory"] }],
        terms: null,
        registrationFile: null,
      },
      http: [],
    },
  });
  assert.equal(facts.id, "https://agent-atlas-phi.vercel.app/agent_atlas");
  assert.equal(facts.label, "agent_atlas");
  assert.deepEqual(facts.skills.map((s) => s.id), ["search_directory"]);
  assert.equal(facts.capabilities.authentication, undefined);
});

test("an x402 seller declares x402 as its payment method under capabilities.authentication", () => {
  const facts = buildAgentFacts(INPUT);
  assert.deepEqual(facts.capabilities.authentication.methods, ["x402"]);
});

test("the output is plain JSON and the input is not changed", () => {
  const before = JSON.stringify(INPUT);
  const facts = buildAgentFacts(INPUT);
  assert.deepEqual(JSON.parse(JSON.stringify(facts)), facts);
  assert.equal(JSON.stringify(INPUT), before);
});

test("a pillar that does not apply is listed as not applicable, never as a pass; unofficial registries are shown apart", () => {
  const facts = buildAgentFacts({
    ...INPUT,
    verdict: { verdict: "ALLOW", reasons: [{ pillar: "delivery", code: "delivery_not_applicable", effect: "NOT_APPLICABLE", applicable: false, text: "Not applicable" }] },
    identity: { ...INPUT.identity, unofficial: [{ agentId: 194, agentRegistry: "eip155:42220:0xaC3DF9ABf80d0F5c020C06B04Cced27763355944", note: "shown only" }] },
  });
  assert.deepEqual(facts.x_factgate_verdict.notApplicable, ["delivery: not applicable (not a pass)"]);
  assert.equal(facts.x_factgate_unofficial_registries[0].agentId, 194);
  assert.doesNotMatch(JSON.stringify(facts.x_factgate_verdict.notApplicable), /pass"/);
});
