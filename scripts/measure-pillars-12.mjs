// Measure pillars 1–2 only (no vet402): node scripts/measure-pillars-12.mjs <https-url>
import { gateCheck, summarizeCheck } from "../site/js/gatecheck.mjs";
import { corsFetch } from "./cors-fetch.mjs";

const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) {
  console.error("Usage: node scripts/measure-pillars-12.mjs <https-url>");
  process.exit(1);
}
const result = await gateCheck(
  { url },
  { fetch: corsFetch({ origin: "https://factgate.vercel.app" }), skipDelivery: true, skipNanda: true, timeoutMs: 25000 },
);
const summary = summarizeCheck(result);
const p12 = result.reasons.filter((r) => r.pillar === "live" || r.pillar === "identity").map((r) => `${r.pillar}:${r.effect}:${r.code}`);
console.log(JSON.stringify({ url, verdict: result.verdict, pillars12: p12, summary }, null, 2));