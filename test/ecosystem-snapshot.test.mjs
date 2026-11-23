// Ecosystem snapshot script output shape (aggregate counts only).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SUMMARY = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "evidence", "ecosystem", "SUMMARY.json");

test("ecosystem SUMMARY.json has only aggregate counts, no per-site names", async () => {
  const raw = await readFile(SUMMARY, "utf8");
  const s = JSON.parse(raw);
  for (const key of [
    "sitesListed",
    "sitesProbed",
    "answeredAsDeclared",
    "manifestsCorsReadable",
    "declareErc8004",
    "instructionScansClean",
    "verdicts",
  ]) {
    assert.ok(Object.hasOwn(s, key), `missing ${key}`);
  }
  assert.equal(typeof s.sitesListed, "number");
  assert.equal(typeof s.answeredAsDeclared, "number");
  assert.equal(typeof s.verdicts.ALLOW, "number");
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /agent402|agent-atlas|shutdown-clerk|nanda-seal/i, "per-site names must not appear");
});