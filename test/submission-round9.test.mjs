import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

test("docs/devpost.md: audience before the link", async () => {
  const body = await mustRead("docs/devpost.md");
  assert.match(
    body,
    /For an agent builder about to load a partner agent site or pay an x402 seller/i
  );
  assert.match(body, /the card says what to do before the link/i);
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