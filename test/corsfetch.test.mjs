// Tests for the Node CORS emulation used by scripts/probe-live.mjs. It must refuse whatever a
// browser would refuse, so the recorded evidence never shows more than the page can read.
import assert from "node:assert/strict";
import test from "node:test";
import { corsFetch, unsafeRequestHeaders } from "../scripts/cors-fetch.mjs";

const ORIGIN = "http://localhost:8790";

function base(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {} });
    return handler(url, init);
  };
  return { f, calls };
}

test("a simple GET with Access-Control-Allow-Origin passes, and unexposed headers are hidden", async () => {
  const { f, calls } = base(() => new Response("{}", { status: 402, headers: { "access-control-allow-origin": "*", "content-type": "application/json", "payment-required": "abc", "x-secret": "1" } }));
  const res = await corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/a");
  assert.equal(res.status, 402);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("payment-required"), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.origin, ORIGIN);
});

test("exposed headers stay readable", async () => {
  const { f } = base(() => new Response("{}", { status: 402, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "PAYMENT-REQUIRED", "payment-required": "abc" } }));
  const res = await corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/a");
  assert.equal(res.headers.get("payment-required"), "abc");
});

test("an answer without Access-Control-Allow-Origin is a TypeError, like a browser", async () => {
  const { f } = base(() => new Response("x", { status: 404 }));
  await assert.rejects(corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/a"), TypeError);
});

test("a JSON POST sends the preflight first and stops when it is refused", async () => {
  const { f, calls } = base((url, init) => (init.method === "OPTIONS" ? new Response(null, { status: 405 }) : new Response("{}", { headers: { "access-control-allow-origin": "*" } })));
  await assert.rejects(corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), /preflight/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "OPTIONS");
  assert.equal(calls[0].headers["Access-Control-Request-Headers"], "content-type");
});

test("a preflight that does not allow a requested header refuses the request", async () => {
  const { f } = base((url, init) => (init.method === "OPTIONS" ? new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } }) : new Response("{}", { headers: { "access-control-allow-origin": "*" } })));
  await assert.rejects(corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/mcp", { method: "POST", headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18" }, body: "{}" }), /mcp-protocol-version/);
});

test("a preflight that allows everything lets the POST through", async () => {
  const { f, calls } = base((url, init) => (init.method === "OPTIONS" ? new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } }) : new Response('{"ok":1}', { headers: { "access-control-allow-origin": ORIGIN } })));
  const res = await corsFetch({ origin: ORIGIN, baseFetch: f })("https://s.example/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.deepEqual(await res.json(), { ok: 1 });
  assert.equal(calls.length, 2);
});

test("unsafeRequestHeaders leaves out the CORS-safelisted ones", () => {
  assert.deepEqual(unsafeRequestHeaders({ accept: "application/json", "content-type": "text/plain" }), []);
  assert.deepEqual(unsafeRequestHeaders({ "content-type": "application/json", "mcp-session-id": "x" }), ["content-type", "mcp-session-id"]);
});
