// Tests for the FactGate verdict engine. Run: node --test "test/*.test.mjs"
// The engine is a pure function: no network, no LLM, no clock.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateGate, deliveryFromMcp, liveFromProbe } from "../site/js/gate.mjs";

const PAYEE = "0xAbF4FabD7c416fB67202e5F9002389Fc75e2A9d0";
const OTHER = "0x1111111111111111111111111111111111111111";

const goodLive = { status: "ok", data: { corsReachable: true, answersAsDeclared: true } };
const goodIdentity = {
  status: "ok",
  data: { declaredPayTo: PAYEE, registered: { owner: PAYEE.toLowerCase(), agentWallet: null, payTo: null } },
};
const goodDelivery = {
  status: "ok",
  data: {
    recommendation: "ALLOW",
    reason_codes: ["l0_pass", "l1_delivered", "l2_conform"],
    delivery: { paid_attempts: 3, delivered: 3, settled_not_delivered: 0 },
    not_in_catalog: false,
  },
};

function codes(result) {
  return result.reasons.map((r) => r.code);
}

test("all three pillars good gives ALLOW", () => {
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: goodDelivery });
  assert.equal(r.verdict, "ALLOW");
  assert.deepEqual(codes(r), ["live_as_declared", "identity_match", "delivery_delivered"]);
});

test("payee that differs from the ERC-8004 registration gives BLOCK", () => {
  const identity = { status: "ok", data: { declaredPayTo: OTHER, registered: { owner: PAYEE, agentWallet: PAYEE, payTo: null } } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(r).includes("identity_payee_mismatch"));
});

test("payee comparison ignores address case", () => {
  const identity = { status: "ok", data: { declaredPayTo: PAYEE.toUpperCase().replace("0X", "0x"), registered: { owner: OTHER, agentWallet: PAYEE.toLowerCase() } } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "ALLOW");
});

test("a record of an empty response after payment gives BLOCK (settled_not_delivered)", () => {
  const delivery = { status: "ok", data: { ...goodDelivery.data, delivery: { paid_attempts: 3, delivered: 2, settled_not_delivered: 1 } } };
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(r).includes("delivery_paid_empty"));
});

test("a record of an empty response after payment gives BLOCK (reason code l1_paid_not_delivered)", () => {
  const delivery = { status: "ok", data: { ...goodDelivery.data, reason_codes: ["l0_pass", "l1_paid_not_delivered"] } };
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(r).includes("delivery_paid_empty"));
});

test("a counterparty the browser cannot reach over CORS gives CAUTION", () => {
  const live = { status: "ok", data: { corsReachable: false, answersAsDeclared: null } };
  const r = evaluateGate({ live, identity: goodIdentity, delivery: goodDelivery });
  assert.equal(r.verdict, "CAUTION");
  assert.ok(codes(r).includes("live_cors_unreachable"));
});

test("a pillar whose data could not be fetched is CAUTION, reported as unavailable", () => {
  const delivery = { status: "unavailable", error: "vet402 MCP HTTP 503" };
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery });
  assert.equal(r.verdict, "CAUTION");
  const reason = r.reasons.find((x) => x.pillar === "delivery");
  assert.equal(reason.code, "delivery_unavailable");
  assert.match(reason.text, /could not/i);
  assert.match(reason.text, /503/);
});

test("unavailable is not mixed with zero: no data and zero attempts give different reasons", () => {
  const zero = { status: "ok", data: { recommendation: "WARN", reason_codes: [], delivery: { paid_attempts: 0, delivered: 0, settled_not_delivered: 0 }, not_in_catalog: false } };
  const a = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: zero });
  const b = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: { status: "unavailable", error: "timeout" } });
  assert.equal(a.verdict, "CAUTION");
  assert.equal(b.verdict, "CAUTION");
  assert.equal(a.reasons[2].code, "delivery_no_record");
  assert.equal(b.reasons[2].code, "delivery_unavailable");
});

test("a missing pillar is treated as unavailable, never as good", () => {
  const r = evaluateGate({ live: goodLive, delivery: goodDelivery });
  assert.equal(r.verdict, "CAUTION");
  assert.ok(codes(r).includes("identity_unavailable"));
  const all = evaluateGate({});
  assert.equal(all.verdict, "CAUTION");
  assert.deepEqual(codes(all), ["live_unavailable", "identity_unavailable", "delivery_unavailable"]);
});

test("BLOCK wins over CAUTION from another pillar", () => {
  const live = { status: "unavailable", error: "x" };
  const identity = { status: "ok", data: { declaredPayTo: OTHER, registered: { owner: PAYEE } } };
  const r = evaluateGate({ live, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "BLOCK");
});

test("live answer that does not match the declaration gives BLOCK", () => {
  const live = { status: "ok", data: { corsReachable: true, answersAsDeclared: false, detail: "402 payTo differs from manifest" } };
  const r = evaluateGate({ live, identity: goodIdentity, delivery: goodDelivery });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(r).includes("live_not_as_declared"));
});

test("unregistered agent and vet402 BLOCK / not-in-catalog are handled", () => {
  const unreg = { status: "ok", data: { declaredPayTo: PAYEE, registered: null } };
  assert.equal(evaluateGate({ live: goodLive, identity: unreg, delivery: goodDelivery }).verdict, "CAUTION");
  const vblock = { status: "ok", data: { ...goodDelivery.data, recommendation: "BLOCK", reason_codes: ["l0_fail"] } };
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: vblock });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(r).includes("delivery_vet402_block"));
  const nic = { status: "ok", data: { not_in_catalog: true } };
  const r2 = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: nic });
  assert.equal(r2.verdict, "CAUTION");
  assert.ok(codes(r2).includes("delivery_no_record"));
});

test("the result is the same for the same input and the input is not changed", () => {
  const input = { live: goodLive, identity: goodIdentity, delivery: goodDelivery };
  const before = JSON.stringify(input);
  assert.deepEqual(evaluateGate(input), evaluateGate(input));
  assert.equal(JSON.stringify(input), before);
});

test("deliveryFromMcp reads a real vet402 check_x402_seller answer (recorded 2026-11-22)", async () => {
  const rpc = JSON.parse(await readFile(new URL("./fixtures/vet402_check_x402_seller_allow.json", import.meta.url), "utf8"));
  const pillar = deliveryFromMcp(rpc);
  assert.equal(pillar.status, "ok");
  assert.equal(pillar.data.recommendation, "ALLOW");
  assert.equal(pillar.data.delivery.delivered, 3);
  const r = evaluateGate({ live: goodLive, identity: goodIdentity, delivery: pillar });
  assert.equal(r.verdict, "ALLOW");
});

test("deliveryFromMcp turns an MCP tool error into unavailable, not into a zero record", async () => {
  const rpc = JSON.parse(await readFile(new URL("./fixtures/vet402_check_8004_agent_error.json", import.meta.url), "utf8"));
  const pillar = deliveryFromMcp(rpc);
  assert.equal(pillar.status, "unavailable");
  assert.ok(pillar.error.length > 0);
  assert.equal(deliveryFromMcp(null).status, "unavailable");
  assert.equal(deliveryFromMcp({ error: { code: -32601, message: "no method" } }).status, "unavailable");
});

test("liveFromProbe maps a browser fetch TypeError to CORS-unreachable", () => {
  assert.deepEqual(liveFromProbe({ fetchError: "TypeError: Failed to fetch" }).data.corsReachable, false);
  assert.equal(liveFromProbe({ allowOrigin: null, httpStatus: 200 }).data.corsReachable, false);
  const ok = liveFromProbe({ allowOrigin: "*", httpStatus: 402, matchesDeclaration: true });
  assert.equal(ok.data.corsReachable, true);
  assert.equal(ok.data.answersAsDeclared, true);
  assert.equal(liveFromProbe(undefined).status, "unavailable");
});

test("pillarsFromArgs maps flat action arguments and never fills missing fields with zeros", async () => {
  const { pillarsFromArgs } = await import("../site/js/gate.mjs");
  const p = pillarsFromArgs({
    live: { status: "ok", corsReachable: true, answersAsDeclared: "yes" },
    identity: { status: "ok", declaredPayTo: PAYEE, registered: true, owner: PAYEE },
    delivery: { status: "ok", recommendation: "ALLOW", reasonCodes: ["l1_delivered"], paidAttempts: 3, delivered: 3, settledNotDelivered: 0 },
  });
  assert.equal(evaluateGate(p).verdict, "ALLOW");
  const partial = pillarsFromArgs({ delivery: { status: "ok", recommendation: "ALLOW" } });
  assert.equal(partial.delivery.status, "unavailable");
  assert.match(partial.delivery.error, /paidAttempts/);
  assert.equal(evaluateGate(partial).reasons[2].code, "delivery_unavailable");
  const nic = pillarsFromArgs({ delivery: { status: "ok", notInCatalog: true } });
  assert.equal(evaluateGate(nic).reasons[2].code, "delivery_no_record");
  const unreg = pillarsFromArgs({ identity: { status: "ok", declaredPayTo: PAYEE, registered: false } });
  assert.equal(evaluateGate(unreg).reasons[1].code, "identity_unregistered");
  const down = pillarsFromArgs({ live: { status: "unavailable", error: "timeout" } });
  assert.equal(down.live.status, "unavailable");
  assert.equal(pillarsFromArgs({ live: { status: "ok", corsReachable: true, answersAsDeclared: "not_compared" } }).live.data.answersAsDeclared, null);
});

// ---- Stage 2 (2026-11-22): rules added with pillars 1 and 2 ----

const ZERO = "0x0000000000000000000000000000000000000000";

test("a zero-address payee never matches a zero agentWallet", () => {
  const identity = { status: "ok", data: { declaredPayTo: ZERO, registered: { owner: PAYEE, agentWallet: ZERO } } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.notEqual(r.verdict, "ALLOW");
  assert.equal(r.reasons[1].code, "identity_no_declared_payee");
});

test("every declared EVM payee must be registered: one stranger among them gives BLOCK", () => {
  const identity = { status: "ok", data: { declaredPayTo: PAYEE, declaredPayTos: [PAYEE, OTHER], registered: { owner: PAYEE, agentWallet: PAYEE, bound: true } } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "BLOCK");
  assert.equal(r.reasons[1].code, "identity_payee_mismatch");
  assert.match(r.reasons[1].text, /0x1111/);
});

test("a mismatch against an agent that does not claim this URL is CAUTION, not BLOCK", () => {
  const identity = { status: "ok", data: { declaredPayTo: OTHER, registered: { owner: PAYEE, agentWallet: PAYEE, bound: false } } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "CAUTION");
  assert.equal(r.reasons[1].code, "identity_unbound");
});

test("a declared capability the browser cannot reach makes the live pillar CAUTION", () => {
  const live = { status: "ok", data: { corsReachable: true, answersAsDeclared: true, unreachable: ["MCP https://x.example/mcp: TypeError"] } };
  const r = evaluateGate({ live, identity: goodIdentity, delivery: goodDelivery });
  assert.equal(r.verdict, "CAUTION");
  assert.equal(r.reasons[0].code, "live_capability_unreachable");
});

test("a declaration mismatch still wins over an unreachable capability", () => {
  const live = { status: "ok", data: { corsReachable: true, answersAsDeclared: false, detail: "tools missing", unreachable: ["MCP x"] } };
  assert.equal(evaluateGate({ live, identity: goodIdentity, delivery: goodDelivery }).verdict, "BLOCK");
});

test("a registration that is only declared, not on chain, is CAUTION even when the payee matches it", () => {
  const identity = { status: "ok", data: { declaredPayTo: PAYEE, declaredOnly: true, declaredReason: "agentRegistry is not the official IdentityRegistry", registered: null } };
  const r = evaluateGate({ live: goodLive, identity, delivery: goodDelivery });
  assert.equal(r.verdict, "CAUTION");
  assert.equal(r.reasons[1].code, "identity_declared_only");
  assert.match(r.reasons[1].text, /official/);
});
