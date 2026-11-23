import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function mustRead(relFromRoot) {
  return readFile(path.join(ROOT, relFromRoot), "utf8");
}

test("README hero table: Stay Steward URL beside VS-0001", async () => {
  const readme = await mustRead("README.md");
  const heroRow = readme.match(
    /\| Verified Stay[\s\S]*?\n\|[-|]+\|\n([\s\S]*?)\n\n/
  );
  assert.ok(heroRow, "hero table row missing");
  assert.match(heroRow[1], /VS-0001/);
  assert.match(
    heroRow[1],
    /stay-steward-demo\.vercel\.app/,
    "Verified Stay cell should link Stay Steward demo beside VS-0001"
  );
});

test("index.html masthead: Stay Steward links to demo", async () => {
  const page = await mustRead("site/index.html");
  const start = page.indexOf("<header class=\"masthead\">");
  const masthead = page.slice(start, page.indexOf("</header>", start));
  assert.match(
    masthead,
    /<a[^>]+href="https:\/\/stay-steward-demo\.vercel\.app\/"[^>]*>Stay Steward<\/a>/
  );
});
