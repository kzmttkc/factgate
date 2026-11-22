import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOTES = path.join(ROOT, "..", "factgate-notes");
const PEERS = path.join(ROOT, "..", "factgate-peers");

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

function countSayWords(script) {
  const sayBlocks = [...script.matchAll(/^SAY:\n([\s\S]*?)(?=\n\n### |\n\nSCREEN |\n---|\n## Shot)/gm)];
  let words = 0;
  for (const [, block] of sayBlocks) {
    for (const line of block.trim().split("\n")) {
      const t = line.trim();
      if (!t) continue;
      words += t.split(/\s+/).length;
    }
  }
  return words;
}

test("README measured table: agent402 row closed at 2026-12-07", async () => {
  const readme = await mustRead("README.md");
  const row = readme.match(
    /\| agent402\.tools\/api\/weather-forecast[\s\S]*?\n/
  );
  assert.ok(row, "agent402 table row missing");
  assert.match(row[0], /ALLOW on 2026-11-22 only/);
  assert.match(row[0], /After 2026-12-07/);
  assert.doesNotMatch(row[0], /\| ALLOW \(Link \/ pay: OK\) \| Answers as declared;/);
});

test("README product question: should my agent connect", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /should my agent connect to this agent site/i);
  assert.doesNotMatch(readme, /is it safe to connect to this agent site/i);
});

test("index.html masthead: hotel fail story and tool contrast", async () => {
  const page = await mustRead("site/index.html");
  const start = page.indexOf("<header class=\"masthead\">");
  const masthead = page.slice(start, page.indexOf("</header>", start));
  assert.match(masthead, /I built Glossy Stay to fail/);
  assert.match(masthead, /ScopeGate Studio watches the call leave/);
  assert.match(masthead, /none of them stops the link/i);
});

test("docs/devpost.md: only fictional BLOCK through judging", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.match(body, /only BLOCK.*2027-01-18.*fictional Glossy Stay/is);
  assert.match(body, /Five real contest sites.*CAUTION.*not blocked/is);
});

test("demo script round 7: trimmed SAY, timing, recording date", async () => {
  const script = await readFile(path.join(NOTES, "video", "SCRIPT_final.md"), "utf8");
  assert.match(script, /recording 2026-11-24/);
  assert.doesNotMatch(script, /So I built FactGate\./);
  assert.doesNotMatch(script, /Before my agent links or pays, it checks three things\./);
  assert.match(script, /My code decides\. The model only explains\./);
  assert.match(script, /SCREEN C \(1:10–1:28\)/);
  assert.match(script, /\| 9 \| 1:53–1:58 \|/);
  const headerWords = script.match(/Spoken words: (\d+)/);
  assert.ok(headerWords, "Spoken words header missing");
  const spoken = countSayWords(script);
  assert.equal(Number(headerWords[1]), spoken, "header word count must match SAY lines");
  assert.ok(spoken <= 280, `spoken script too long for 2:00 at ~150 wpm (${spoken} words)`);
});

test("stay-steward index: Glossy as the planted fail hotel", async () => {
  const page = await readFile(path.join(PEERS, "stay-steward", "index.html"), "utf8");
  const sub = page.indexOf("Books stays for you");
  assert.ok(sub >= 0);
  const afterSub = page.slice(sub, sub + 600);
  assert.match(afterSub, /Glossy Stay is the hotel this demo built to fail/);
  assert.match(afterSub, /Verified Stay should book/);
});