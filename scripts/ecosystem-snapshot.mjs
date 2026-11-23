// Aggregate probe of contest-listed agentic websites (no per-site names in output).
// Usage: node scripts/ecosystem-snapshot.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateCheck } from "../site/js/gatecheck.mjs";
import { corsFetch } from "./cors-fetch.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LIST_URL =
  "https://raw.githubusercontent.com/cognizant-ai-labs/agentic-web/main/docs/agentic_websites.md";
const OUT = path.join(ROOT, "evidence", "ecosystem", "SUMMARY.json");
const ORIGIN = "https://factgate.vercel.app";
const SKIP_HOST = /factgate/i;

function agentUrlsFromMarkdown(text) {
  const urls = new Set();
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || line.includes("Agent URL")) {
      continue;
    }
    for (const m of line.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)) {
      let u = m[1].trim();
      if (u.endsWith(".network.json")) {
        u = u.replace(/\/[^/]+\.network\.json$/, (match) => match.replace(".network.json", ""));
      }
      urls.add(u);
    }
  }
  return [...urls];
}

function manifestReadable(result) {
  const m = result.evidence.live.checks && result.evidence.live.checks.manifest;
  return m && m.state === "found";
}

function declaresRegistration(result) {
  const d = result.evidence.live.declared;
  return Boolean(d && (d.registrationFile || d.registrationUrl));
}

function instructionsClean(result) {
  const i = result.evidence.live.checks && result.evidence.live.checks.instructions;
  if (!i || i.state !== "scanned") {
    return false;
  }
  return Array.isArray(i.findings) && i.findings.length === 0;
}

async function main() {
  const listRes = await fetch(LIST_URL);
  if (!listRes.ok) {
    throw new Error(`could not read list: HTTP ${listRes.status}`);
  }
  const listText = await listRes.text();
  const listed = agentUrlsFromMarkdown(listText);
  const targets = listed.filter((u) => {
    try {
      return !SKIP_HOST.test(new URL(u).host);
    } catch {
      return false;
    }
  });
  const fetchImpl = corsFetch({ origin: ORIGIN });
  const verdicts = { ALLOW: 0, CAUTION: 0, BLOCK: 0 };
  let answeredAsDeclared = 0;
  let manifestsCorsReadable = 0;
  let declareErc8004 = 0;
  let instructionScansClean = 0;
  for (const url of targets) {
    const result = await gateCheck({ url }, { fetch: fetchImpl, timeoutMs: 20000, skipDelivery: true, skipNanda: true });
    verdicts[result.verdict] = (verdicts[result.verdict] || 0) + 1;
    const live = result.evidence.live.pillar;
    if (live && live.status === "ok" && live.data && live.data.answersAsDeclared === true) {
      answeredAsDeclared += 1;
    }
    if (manifestReadable(result)) {
      manifestsCorsReadable += 1;
    }
    if (declaresRegistration(result)) {
      declareErc8004 += 1;
    }
    if (instructionsClean(result)) {
      instructionScansClean += 1;
    }
  }
  const summary = {
    measuredAt: new Date().toISOString(),
    pageOrigin: ORIGIN,
    listSource: LIST_URL,
    sitesListed: listed.length,
    sitesProbed: targets.length,
    answeredAsDeclared,
    manifestsCorsReadable,
    declareErc8004,
    instructionScansClean,
    verdicts,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});