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

const KEYLESS_ASSISTANT_LINE =
  "The check above needs no key. The assistant is optional. Add a key in AI model settings.";

test("docs/devpost.md: Stay Steward click path for judges", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.match(body, /Open Stay Steward/i);
  assert.match(body, /Check with FactGate/i);
  assert.match(body, /Verified Stay books VS-0001/i);
  assert.match(body, /Glossy Stay stops at Do not pay/i);
});

test("site.js: keyless path status and chrome line", async () => {
  const site = await mustRead("site/site.js");
  assert.match(site, new RegExp(KEYLESS_ASSISTANT_LINE.replace(/\./g, "\\.")));
  assert.doesNotMatch(site, /Assistant needs your AI provider key/);
});

test("stay-steward index: provider settings start closed like FactGate", async () => {
  const page = await readFile(path.join(PEERS, "stay-steward", "index.html"), "utf8");
  assert.match(page, /id="agent-app"[^>]*data-settings-default-closed/);
  const assistant = page.slice(page.indexOf('id="assistant"'), page.indexOf("</main>"));
  assert.match(assistant, /<details[^>]*class="[^"]*ns-settings/);
  assert.doesNotMatch(assistant, /<details[^>]*\sopen[\s>]/);
  assert.match(assistant, /data-ns-slot="settings"/);
});

test("stay-steward ui.js: respect data-settings-default-closed when BYOK missing", async () => {
  const ui = await readFile(path.join(PEERS, "stay-steward", "runtime", "ui.js"), "utf8");
  assert.match(ui, /settingsStartClosed/);
  assert.match(ui, /needsByok && !settingsStartClosed/);
  assert.doesNotMatch(ui, /needsByok \? " open"/);
});