// Tests for pillar 3's second source (ERC-8004 ValidationRegistry) and the two-source rule.
// Offline: the registry and the logs are faked.
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGate, judgeDeliveryPillar } from "../site/js/gate.mjs";
import {
  VALIDATION_CHAINS,
  VALIDATION_REGISTRY,
  VALIDATION_SELECTORS,
  VALIDATION_TOPICS,
  classifyValidations,
  decodeBytes32Array,
  decodeValidationStatus,
  readValidations,
  validationSummary,
} from "../site/js/validation.mjs";
import { keccak256, selector } from "../scripts/keccak256.mjs";

const JUDGE = "0x5ec4599a438fa0559ade8b8551b369d5c5adf0bc";
const OWNER = "0xf98f6b4d8f1a5a03271bbf2bee23236737d9ec31";
const w = (n) => BigInt(n).toString(16).padStart(64, "0");
const addrWord = (a) => a.slice(2).padStart(64, "0");

test("selectors, topics and addresses match the ABI and erc-8004-contracts scripts/addresses.ts", () => {
  assert.equal(VALIDATION_SELECTORS.getAgentValidations, selector("getAgentValidations(uint256)"));
  assert.equal(VALIDATION_SELECTORS.getValidationStatus, selector("getValidationStatus(bytes32)"));
  assert.equal(VALIDATION_TOPICS.response, `0x${keccak256("ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,string)")}`);
  assert.equal(VALIDATION_TOPICS.request, `0x${keccak256("ValidationRequest(address,uint256,string,bytes32)")}`);
  assert.equal(VALIDATION_REGISTRY.testnet, "0x8004Cb1BF31DAf7788923b405b754f57acEB4272");
  assert.equal(VALIDATION_REGISTRY.mainnet, "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58");
});

function statusHex({ validator = JUDGE, agentId = 10798, response, lastUpdate }) {
  return `0x${addrWord(validator)}${w(agentId)}${w(response)}${"ab".repeat(32)}${w(192)}${w(lastUpdate)}${w(0)}`;
}

test("decoders read bytes32[] and the getValidationStatus tuple", () => {
  const hashes = [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`];
  assert.deepEqual(decodeBytes32Array(`0x${w(32)}${w(2)}${"11".repeat(32)}${"22".repeat(32)}`), hashes);
  assert.deepEqual(decodeBytes32Array(`0x${w(32)}${w(0)}`), []);
  assert.equal(decodeBytes32Array("0x"), null);
  const s = decodeValidationStatus(statusHex({ response: 99, lastUpdate: 1795306308 }));
  assert.equal(s.validator, JUDGE);
  assert.equal(s.agentId, "10798");
  assert.equal(s.response, 99);
  assert.equal(s.lastUpdate, 1795306308);
});

test("classify: >= 70 is a pass, 1..69 an answered low, 0 needs the logs, self-validation is set aside", () => {
  const c = classifyValidations(
    [
      { validator: JUDGE, response: 99 },
      { validator: JUDGE, response: 3 },
      { validator: JUDGE, response: 0 },
      { validator: OWNER, response: 100 },
    ],
    [OWNER],
    { chainId: 84532 },
  );
  assert.equal(c.high.length, 1);
  assert.equal(c.low.length, 1);
  assert.equal(c.zero.length, 1);
  assert.equal(c.self.length, 1);
});

test("classify: a validator not on the trusted list is set aside, whatever it scored", () => {
  const STRANGER = "0x7777777777777777777777777777777777777777";
  const c = classifyValidations([{ validator: STRANGER, response: 3 }, { validator: STRANGER, response: 100 }, { validator: JUDGE, response: 99 }], [], { chainId: 84532 });
  assert.equal(c.untrusted.length, 2);
  assert.equal(c.low.length, 0);
  assert.equal(c.high.length, 1);
  // The judge is trusted on Base Sepolia only.
  const mainnet = classifyValidations([{ validator: JUDGE, response: 99 }], [], { chainId: 8453 });
  assert.equal(mainnet.untrusted.length, 1);
  const s = validationSummary(c, { chainId: 84532 });
  assert.equal(s.untrusted, 2);
  assert.deepEqual(s.counted.map((x) => x.validator), [JUDGE]);
  assert.match(s.notCounted[0].reason, /not on the trusted validator list/);
});

test("summary: a pending 0 is not counted, an answered 0 is a failure, an unknown 0 is unresolved", () => {
  const base = { high: [{ validator: JUDGE, response: 99 }], low: [], self: [] };
  assert.equal(validationSummary({ ...base, zero: [{ validator: JUDGE, response: 0, resolved: "pending" }] }).failed, 0);
  assert.equal(validationSummary({ ...base, zero: [{ validator: JUDGE, response: 0, resolved: "answered" }] }).failed, 1);
  assert.equal(validationSummary({ ...base, zero: [{ validator: JUDGE, response: 0, resolved: "unknown" }] }).unresolved, 1);
});

const ok = (data) => ({ status: "ok", data: { chainId: 84532, agentId: "10798", validators: [JUDGE], evidence: [], ...data } });
const noVet = { status: "ok", data: { not_in_catalog: true } };

test("paid counterparty: validation scores >= 70 and none below pass pillar 3 even with no vet402 record", () => {
  const r = judgeDeliveryPillar({ delivery: noVet, validation: ok({ passed: 79, failed: 0, pending: 1, unresolved: 0 }), paid: true });
  assert.equal(r.effect, "ALLOW");
  assert.equal(r.code, "delivery_validated");
  assert.equal(r.sources.length, 2);
});

test("paid counterparty: one validation score below 70 is BLOCK, whatever vet402 says", () => {
  const vetAllow = { status: "ok", data: { recommendation: "ALLOW", reason_codes: [], delivery: { paid_attempts: 3, delivered: 3, settled_not_delivered: 0 }, not_in_catalog: false } };
  const r = judgeDeliveryPillar({ delivery: vetAllow, validation: ok({ passed: 1, failed: 1, lowest: 0 }), paid: true });
  assert.equal(r.effect, "BLOCK");
  assert.equal(r.code, "delivery_validation_low");
});

test("paid counterparty: no record in either source stays CAUTION 'no record'; both unreadable is unavailable", () => {
  assert.equal(judgeDeliveryPillar({ delivery: noVet, validation: ok({ passed: 0, failed: 0 }), paid: true }).code, "delivery_no_record");
  assert.equal(judgeDeliveryPillar({ delivery: { status: "unavailable", error: "x" }, validation: ok({ passed: 0, failed: 0 }), paid: true }).code, "delivery_no_record");
  assert.equal(judgeDeliveryPillar({ delivery: { status: "unavailable", error: "x" }, validation: { status: "unavailable", error: "y" }, paid: true }).code, "delivery_unavailable");
  assert.equal(judgeDeliveryPillar({ delivery: noVet, validation: ok({ passed: 5, failed: 0, unresolved: 1 }), paid: true }).effect, "CAUTION");
});

test("free counterparty (no 402): pillar 3 is not applicable, does not stop ALLOW, and says it is not a pass", () => {
  const live = { status: "ok", data: { corsReachable: true, answersAsDeclared: true } };
  const identity = { status: "ok", data: { declaredPayTo: OWNER, registered: { owner: OWNER, bound: true } } };
  const r = evaluateGate({ live, identity, paid: false });
  assert.equal(r.verdict, "ALLOW");
  assert.equal(r.reasons[2].code, "delivery_not_applicable");
  assert.equal(r.reasons[2].applicable, false);
  assert.equal(r.reasons[2].effect, "NOT_APPLICABLE");
  assert.match(r.reasons[2].text, /not a pass/);
});

// Fake Base Sepolia: two validations, one 99 and one 0 that the logs show was never answered.
function fakeChain({ zeroAnswered }) {
  const H1 = `0x${"aa".repeat(32)}`;
  const H0 = `0x${"bb".repeat(32)}`;
  const tsOf = (n) => 1795200000 + Math.floor(n / 5); // 5 blocks a second
  const one = (b) => {
    let result;
    if (b.method === "eth_call") {
      const data = b.params[0].data;
      if (data.startsWith(VALIDATION_SELECTORS.getAgentValidations)) {
        result = `0x${w(32)}${w(2)}${H1.slice(2)}${H0.slice(2)}`;
      } else if (data.endsWith(H1.slice(2))) {
        result = statusHex({ response: 99, lastUpdate: 1795300000 });
      } else {
        result = statusHex({ response: 0, lastUpdate: 1795290000 });
      }
    } else if (b.method === "eth_blockNumber") {
      result = `0x${(1000000).toString(16)}`;
    } else if (b.method === "eth_getBlockByNumber") {
      result = { timestamp: `0x${tsOf(parseInt(b.params[0], 16)).toString(16)}` };
    } else if (b.method === "eth_getLogs") {
      const f = b.params[0];
      const span = parseInt(f.toBlock, 16) - parseInt(f.fromBlock, 16);
      assert.ok(span <= 199, "range over the public RPC limit");
      const isResp = f.topics[0] === VALIDATION_TOPICS.response;
      const hash = f.topics[3];
      if (hash === H1 && isResp) {
        result = [{ blockNumber: f.fromBlock, transactionHash: `0x${"cd".repeat(32)}`, logIndex: "0xf", data: `0x${w(99)}` }];
      } else if (hash === H0 && isResp && zeroAnswered) {
        result = [{ blockNumber: f.fromBlock, transactionHash: `0x${"ef".repeat(32)}`, logIndex: "0x3", data: `0x${w(0)}` }];
      } else if (hash === H0 && !isResp) {
        result = [{ blockNumber: f.fromBlock, transactionHash: `0x${"12".repeat(32)}`, logIndex: "0x1", data: "0x" }];
      } else {
        result = [];
      }
    }
    return { jsonrpc: "2.0", id: b.id, result };
  };
  return (url, init) => {
    const b = JSON.parse(init.body);
    const answer = Array.isArray(b) ? b.map(one) : one(b);
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  };
}

test("readValidations: an unanswered request is not counted, and the passing score's tx is located", async () => {
  const r = await readValidations({ chainId: 84532, agentId: "10798", selfAddresses: [OWNER] }, fakeChain({ zeroAnswered: false }));
  assert.equal(r.status, "ok");
  assert.equal(r.data.passed, 1);
  assert.equal(r.data.failed, 0);
  assert.equal(r.data.pending, 1);
  const pass = r.data.evidence.find((e) => e.role === "latest passing score");
  assert.equal(pass.log.tx, `0x${"cd".repeat(32)}`);
  assert.equal(pass.log.logIndex, 15);
  assert.equal(judgeDeliveryPillar({ delivery: noVet, validation: r, paid: true }).effect, "ALLOW");
});

test("readValidations: a 0 the logs show was answered is a failure, so pillar 3 is BLOCK", async () => {
  const r = await readValidations({ chainId: 84532, agentId: "10798" }, fakeChain({ zeroAnswered: true }));
  assert.equal(r.data.failed, 1);
  const p = judgeDeliveryPillar({ delivery: noVet, validation: r, paid: true });
  assert.equal(p.effect, "BLOCK");
  assert.match(p.text, /0xefef/);
});

test("readValidations: an unknown chain or an empty registry answer is unavailable", async () => {
  assert.equal((await readValidations({ chainId: 1, agentId: "1" }, async () => null)).status, "unavailable");
  const empty = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }));
  assert.equal((await readValidations({ chainId: 84532, agentId: "1" }, empty)).status, "unavailable");
});

test("readValidations uses the fallback RPC when the first answers 429", async () => {
  const inner = fakeChain({ zeroAnswered: false });
  const primary = VALIDATION_CHAINS[84532].rpc;
  const flaky = (url, init) => {
    if (url === primary) {
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    }
    return inner(url, init);
  };
  const r = await readValidations({ chainId: 84532, agentId: "10798" }, flaky);
  assert.equal(r.status, "ok");
  assert.equal(r.data.passed, 1);
});
