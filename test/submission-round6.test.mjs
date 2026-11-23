import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PEERS = path.join(ROOT, "..", "factgate-peers");

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

function linesBefore(haystack, needle, maxLines = 40) {
  const i = haystack.indexOf(needle);
  assert.ok(i >= 0, `README missing: ${needle}`);
  return haystack.slice(0, i).split("\n").length;
}

const NEUTRAL_COMPARISON =
  "Agent Customs scans prompts. Agent Atlas checks the format. FactGate decides before a partner network loads, from measured live answers, on-chain identity and delivery.";

test("README opening: distinction under the hotel hook, Agents roster below screenshots", async () => {
  const readme = await mustRead("README.md");
  const hookLine = "My agent was about to book the nicer hotel.";
  const hookPos = readme.indexOf(hookLine);
  assert.ok(hookPos >= 0);
  assert.ok(readme.includes(NEUTRAL_COMPARISON), "README missing neutral comparison sentence");
  assert.doesNotMatch(readme, /none of them stops the link/i);
  const agentsRoster = "**Agents:**";
  const screenshotHeading = "**Screenshots**";
  const agentsIdx = readme.indexOf(agentsRoster);
  const shotsIdx = readme.indexOf(screenshotHeading);
  assert.ok(agentsIdx > shotsIdx, "Agents roster should appear after the screenshot table");
  const beforeShots = linesBefore(readme, screenshotHeading);
  assert.ok(!readme.slice(0, shotsIdx).includes(agentsRoster), "Agents roster should not be above screenshots");
  const beforeArch = readme.indexOf("![Architecture]");
  assert.ok(readme.indexOf(NEUTRAL_COMPARISON) < beforeArch, "distinction should be on the first screen");
  assert.ok(readme.indexOf(NEUTRAL_COMPARISON) > hookPos, "distinction should follow the hotel hook");
});

test("README hero table: agent402 ALLOW with vet402 record wording, no fixed paid counts", async () => {
  const readme = await mustRead("README.md");
  assert.doesNotMatch(readme, /2026-12-07/);
  assert.match(readme, /ALLOW \(every paid call delivered, vet402 record, checked 2026-11-22\)/);
  const hero = readme.match(/\| Verified Stay \| Glossy Stay \| agent402\.tools[\s\S]*?\n\n/);
  assert.ok(hero, "hero table missing");
  assert.doesNotMatch(hero[0], /\b3 of 3\b/i);
  assert.doesNotMatch(hero[0], /Unchecked/i);
});

test("README Measured: judging-period story and vet402 re-check", async () => {
  const readme = await mustRead("README.md");
  assert.match(readme, /through judging.*Verified Stay booked \(VS-0001\).*Glossy Stay not loaded/s);
  assert.match(readme, /agent402\.tools\/api\/weather-forecast/);
  assert.match(readme, /scheduled to buy that URL once on 2027-01-10 UTC/);
  assert.match(readme, /Last delivered: 2026-11-07 \(vet402 window: 30 days\)/);
  assert.doesNotMatch(readme, /agent402\.tools will not repeat ALLOW/);
  assert.doesNotMatch(readme, /2026-12-07/);
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
  assert.ok(body.length < 4000, "devpost.md paste should stay within Devpost field limit");
  assert.match(body, /built that hotel to fail/);
  assert.ok(body.includes(NEUTRAL_COMPARISON));
  assert.doesNotMatch(body, /none of them stops the link/i);
  assert.match(body, /Verified Stay booked/);
  assert.match(body, /allow pop-ups for stay-steward-demo\.vercel\.app/i);
  assert.match(body, /agent402\.tools\/api\/weather-forecast/);
  assert.match(body, /2027-01-10 UTC/);
  assert.doesNotMatch(body, /2026-12-07/);
  assert.doesNotMatch(body, /\| Pillar \|/);
});

test("index.html: no try-note beside Try these", async () => {
  const page = await mustRead("site/index.html");
  assert.doesNotMatch(page, /try-note/);
  assert.doesNotMatch(page, /2026-12-07/);
  assert.doesNotMatch(page, /ScopeGate Studio/);
  const tryIdx = page.indexOf("try-row");
  const statusIdx = page.indexOf("full-status");
  assert.ok(tryIdx >= 0 && statusIdx > tryIdx);
  const between = page.slice(tryIdx, statusIdx);
  assert.doesNotMatch(between, /agent402\.tools was ALLOW/);
});
