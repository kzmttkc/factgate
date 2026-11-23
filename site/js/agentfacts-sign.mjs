// Per-session AgentFacts signing and verification (ECDSA P-256, Web Crypto).
import { sha256Hex } from "../runtime/web-crypto.js";

export const SIGNATURE_MEANS =
  "Proves this AgentFacts JSON was not changed after FactGate measured it in this browser session. It does not prove the counterparty is safe. The key is per session, not an identity.";

function sortedValue(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortedValue(value[key]);
  }
  return out;
}

/** UTF-8 bytes of canonical JSON (sorted keys), excluding the signature block. */
export function canonicalAgentFactsBytes(facts) {
  const clone = JSON.parse(JSON.stringify(facts));
  delete clone.x_factgate_signature;
  const text = `${JSON.stringify(sortedValue(clone))}\n`;
  return new TextEncoder().encode(text);
}

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function createSessionSigningKey(cryptoImpl = globalThis.crypto) {
  return cryptoImpl.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
}

export async function signAgentFactsWithSessionKey(facts, keyPair, cryptoImpl = globalThis.crypto) {
  const bytes = canonicalAgentFactsBytes(facts);
  const sig = await cryptoImpl.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, bytes);
  return {
    signed: true,
    algorithm: "ECDSA-P256-SHA256",
    publicJwk: await cryptoImpl.subtle.exportKey("jwk", keyPair.publicKey),
    signature: bufferToBase64Url(sig),
    means: SIGNATURE_MEANS,
  };
}

export async function verifyAgentFactsSignature(facts, cryptoImpl = globalThis.crypto) {
  const block = facts.x_factgate_signature;
  if (!block || block.signed !== true || !block.publicJwk || !block.signature) {
    return { valid: false, reason: "not signed" };
  }
  try {
    const key = await cryptoImpl.subtle.importKey(
      "jwk",
      block.publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    const ok = await cryptoImpl.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlToBuffer(block.signature),
      canonicalAgentFactsBytes(facts),
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (error) {
    return { valid: false, reason: String(error.message || error) };
  }
}

export async function digestHttpBody(bodyText, cryptoImpl = globalThis.crypto) {
  return sha256Hex(bodyText, cryptoImpl);
}