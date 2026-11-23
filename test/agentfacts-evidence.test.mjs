// Evidence integrity: HTTP body digests and per-session AgentFacts signatures.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { buildAgentFacts } from "../site/js/agentfacts.mjs";
import { canonicalAgentFactsBytes, verifyAgentFactsSignature } from "../site/js/agentfacts-sign.mjs";
import { sha256Hex } from "../site/runtime/web-crypto.js";

const FIXTURE_BODY = '{"networks":[{"name":"demo","front_man":"x","hocon":"n.network.json"}]}';

test("each HTTP response body gets a sha256 digest on x_factgate_evidence", async () => {
  const at = "2026-11-23T06:00:00.000Z";
  const url = "https://example.test/agent-manifest.json";
  const digest = await sha256Hex(FIXTURE_BODY);
  const facts = buildAgentFacts({
    url: "https://example.test/counterparty",
    checkedAt: at,
    verdict: { verdict: "CAUTION", reasons: [] },
    live: { pillar: { status: "unavailable" }, declared: {}, http: [] },
    identity: {},
    delivery: {},
    responseDigests: [{ url, sha256: digest, status: 200, at }],
  });
  assert.ok(Array.isArray(facts.x_factgate_evidence));
  assert.equal(facts.x_factgate_evidence.length, 1);
  assert.equal(facts.x_factgate_evidence[0].url, url);
  assert.equal(facts.x_factgate_evidence[0].sha256, digest);
  assert.equal(facts.x_factgate_evidence[0].status, 200);
  assert.equal(facts.x_factgate_evidence[0].at, at);
  assert.equal(await sha256Hex(FIXTURE_BODY), facts.x_factgate_evidence[0].sha256);
});

test("verifyAgentFactsSignature accepts a signature over the canonical JSON", async () => {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", key.publicKey);
  const facts = buildAgentFacts({
    url: "https://agent402.tools/api/weather-forecast",
    checkedAt: "2026-11-23T06:00:00.000Z",
    verdict: { verdict: "ALLOW", reasons: [] },
    live: { pillar: { status: "ok" }, declared: {}, http: [] },
    identity: {},
    delivery: {},
    responseDigests: [],
  });
  const bytes = canonicalAgentFactsBytes(facts);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, bytes);
  facts.x_factgate_signature = {
    signed: true,
    algorithm: "ECDSA-P256-SHA256",
    publicJwk: pub,
    signature: Buffer.from(sig).toString("base64url"),
    means:
      "Proves this JSON was not changed after FactGate measured it in this browser session. It does not prove the counterparty is safe. The key is per session, not an identity.",
  };
  const ok = await verifyAgentFactsSignature(facts, crypto);
  assert.equal(ok.valid, true);
});

test("verifyAgentFactsSignature fails when the JSON was tampered with after signing", async () => {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", key.publicKey);
  const facts = buildAgentFacts({
    url: "https://agent402.tools/api/weather-forecast",
    checkedAt: "2026-11-23T06:00:00.000Z",
    verdict: { verdict: "ALLOW", reasons: [] },
    live: { pillar: { status: "ok" }, declared: {}, http: [] },
    identity: {},
    delivery: {},
    responseDigests: [],
  });
  const bytes = canonicalAgentFactsBytes(facts);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, bytes);
  facts.x_factgate_signature = {
    signed: true,
    algorithm: "ECDSA-P256-SHA256",
    publicJwk: pub,
    signature: Buffer.from(sig).toString("base64url"),
    means:
      "Proves this JSON was not changed after FactGate measured it in this browser session. It does not prove the counterparty is safe. The key is per session, not an identity.",
  };
  facts.x_factgate_verdict.verdict = "BLOCK";
  const bad = await verifyAgentFactsSignature(facts, crypto);
  assert.equal(bad.valid, false);
});