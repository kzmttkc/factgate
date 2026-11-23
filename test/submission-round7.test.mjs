import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PEERS = path.join(ROOT, "..", "factgate-peers");

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

test("README measured table: agent402 row uses vet402 record wording without paid counts", async () => {
  const readme = await mustRead("README.md");
  const row = readme.match(
    /\| agent402\.tools\/api\/weather-forecast[\s\S]*?\n/
  );
  assert.ok(row, "agent402 table row missing");
  assert.match(row[0], /every paid call delivered, vet402 record, checked 2026-11-22/);
  assert.doesNotMatch(row[0], /\b3 of 3\b/i);
  assert.doesNotMatch(row[0], /2026-12-07/);
  assert.doesNotMatch(row[0], /After 2026-12-07/);
});

test("README product question: should my agent connect", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /should my agent connect to this agent site/i);
  assert.doesNotMatch(readme, /is it safe to connect to this agent site/i);
});

test("index.html masthead: hotel fail story only", async () => {
  const page = await mustRead("site/index.html");
  const start = page.indexOf("<header class=\"masthead\">");
  const masthead = page.slice(start, page.indexOf("</header>", start));
  assert.match(masthead, /I built Glossy Stay to fail/);
  assert.doesNotMatch(masthead, /ScopeGate Studio/);
  assert.doesNotMatch(masthead, /none of them stops the link/i);
});

test("docs/devpost.md: fictional Glossy BLOCK through judging", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.match(body, /Glossy Stay's BLOCK through 2027-01-18/);
  assert.match(body, /Glossy Stay is a fictional demo/);
  assert.match(body, /five contest sites measured CAUTION for identity unknown/i);
});

test("stay-steward index: Glossy as the planted fail hotel", async () => {
  const page = await readFile(path.join(PEERS, "stay-steward", "index.html"), "utf8");
  const sub = page.indexOf("Books stays for you");
  assert.ok(sub >= 0);
  const afterSub = page.slice(sub, sub + 600);
  assert.match(afterSub, /Glossy Stay is the hotel this demo built to fail/);
  assert.match(afterSub, /Verified Stay should book/);
});