import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOTES = path.join(ROOT, "..", "factgate-notes");
const PEERS = path.join(ROOT, "..", "factgate-peers");

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

function linesBefore(haystack, needle, maxLines = 40) {
  const i = haystack.indexOf(needle);
  assert.ok(i >= 0, `README missing: ${needle}`);
  return haystack.slice(0, i).split("\n").length;
}

test("README opening: distinction under the hotel hook, Agents roster below screenshots", async () => {
  const readme = await mustRead("README.md");
  const hookLine = "My agent was about to book the nicer hotel.";
  const hookPos = readme.indexOf(hookLine);
  assert.ok(hookPos >= 0);
  const distinction =
    "FactGate runs before a partner network loads and returns ALLOW, CAUTION, or BLOCK in page code; ScopeGate Studio watches the call as it leaves, Agent Customs scans the prompt, and Agent Atlas checks the manifest format, and none of them stops the link.";
  assert.ok(readme.includes(distinction), "README missing three-tool distinction sentence");
  const agentsRoster = "**Agents:**";
  const screenshotHeading = "**Screenshots**";
  const agentsIdx = readme.indexOf(agentsRoster);
  const shotsIdx = readme.indexOf(screenshotHeading);
  assert.ok(agentsIdx > shotsIdx, "Agents roster should appear after the screenshot table");
  const beforeShots = linesBefore(readme, screenshotHeading);
  assert.ok(!readme.slice(0, shotsIdx).includes(agentsRoster), "Agents roster should not be above screenshots");
  const beforeArch = readme.indexOf("![Architecture]");
  assert.ok(readme.indexOf(distinction) < beforeArch, "distinction should be on the first screen");
  assert.ok(readme.indexOf(distinction) > hookPos, "distinction should follow the hotel hook");
});

test("README hero table: agent402 ALLOW is dated through 2026-12-07 only", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /2026-12-07/);
  assert.match(readme, /2027-01-12\.\.18/);
  assert.match(readme, /ALLOW on 2026-11-22 only \(3 of 3\)/);
  const hero = readme.match(/\| Verified Stay \| Glossy Stay \| agent402\.tools[\s\S]*?\n\n/);
  assert.ok(hero, "hero table missing");
  assert.ok(!hero[0].includes("ALLOW, 3/3 paid calls delivered"), "hero still promises timeless ALLOW 3/3");
});

test("README Measured: judging-period story and agent402 window", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /through judging.*Verified Stay booked \(VS-0001\).*Glossy Stay not loaded/s);
  assert.match(readme, /agent402\.tools will not repeat ALLOW after 2026-12-07/);
  assert.match(readme, /Unchecked — do not treat as safe/);
});

test("README screenshot table includes Stay Steward CAUTION Unchecked card", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /Unchecked — do not treat as safe/);
  assert.match(readme, /caution-stay-steward-1440\.png/);
  assert.match(readme, /caution-stay-steward-390\.png/);
  for (const f of ["screenshots/caution-stay-steward-1440.png", "screenshots/caution-stay-steward-390.png"]) {
    await access(path.join(ROOT, f));
  }
});

test("docs/devpost.md is a short paste-only opening", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.ok(body.length < 2500, "devpost.md should stay short");
  assert.match(body, /built that hotel to fail/);
  assert.match(body, /ScopeGate Studio/);
  assert.match(body, /Verified Stay booked/);
  assert.match(body, /2026-12-07/);
  assert.doesNotMatch(body, /\| Pillar \|/);
});

test("index.html notes agent402 ALLOW window beside Try these", async () => {
  const page = await mustRead("site/index.html");
  assert.match(page, /2026-12-07/);
  assert.match(page, /Unchecked/);
  const tryIdx = page.indexOf("try-row");
  const windowIdx = page.indexOf("2026-12-07");
  assert.ok(windowIdx > tryIdx && windowIdx < page.indexOf("full-status"), "window note should sit with Try these");
});

test("demo script: https chat line, tool contrast, and SCREEN C window", async () => {
  const script = await readFile(path.join(NOTES, "video", "SCRIPT_final.md"), "utf8");
  assert.match(script, /Check https:\/\/glossy-stay-demo\.vercel\.app\/glossy_stay before I book/);
  assert.doesNotMatch(script, /Check glossy-stay-demo\.vercel\.app before I book/);
  assert.match(script, /ScopeGate Studio watches the call leave/);
  assert.match(script, /On 2026-11-23, 102 of 138/);
  assert.doesNotMatch(script, /In the NANDA Index today/);
  assert.match(script, /after 2026-12-07 this same button says unchecked/i);
});