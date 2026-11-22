import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOTES = path.join(ROOT, "..", "factgate-notes");

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

const TOOL_CONTRAST =
  "ScopeGate guards the call as it leaves · Agent Customs scans the prompt · Agent Atlas checks the format";

test("docs/devpost.md: audience before the link", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.match(
    body,
    /For an agent builder about to load a partner agent site or pay an x402 seller/i
  );
  assert.match(body, /the card says what to do before the link/i);
});

test("demo script WHY hold: tool contrast then three pillars", async () => {
  const script = await readFile(path.join(NOTES, "video", "SCRIPT_final.md"), "utf8");
  assert.match(script, new RegExp(`CAPTION \\(0:22–0:28\\):.*${TOOL_CONTRAST.replace(/·/g, "·")}`));
  assert.match(
    script,
    /CAPTION \(0:28–0:34\): `1 live answers · 2 identity on chain · 3 delivered after payment → code decides`/
  );
  const shot2 = script.match(/\| 2 \| 0:14–0:34 \|[\s\S]*?\n/);
  assert.ok(shot2, "shot list row 2 missing");
  assert.match(shot2[0], /three pillars/i);
  assert.match(shot2[0], /ScopeGate|three tools/i);
});

test("index assistant: provider settings start closed, script can open", async () => {
  const page = await mustRead("site/index.html");
  assert.match(page, /id="agent-app"[^>]*data-settings-default-closed/);
  const assistant = page.slice(page.indexOf('id="assistant"'), page.indexOf('id="settings"'));
  assert.match(assistant, /<details[^>]*class="[^"]*ns-settings/);
  assert.doesNotMatch(assistant, /<details[^>]*\sopen[\s>]/);
  assert.match(assistant, /AI model settings/);
  assert.match(assistant, /data-ns-slot="settings"/);
});