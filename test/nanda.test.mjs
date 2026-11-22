// NANDA Index lookup (item 7 of the second grading). The fixture is four organization records exactly as
// https://api.nandaindex.org/api/v1/index returned them on 2026-11-22.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gateCheck } from "../site/js/gatecheck.mjs";
import { lookupNanda, matchNanda, nandaLine, nandaSummary } from "../site/js/nanda.mjs";
import { inspectManifestRead, resolveTarget } from "../site/js/reads.mjs";

const RECORDS = JSON.parse(await readFile(new URL("./fixtures/nanda_index_sample.json", import.meta.url), "utf8"));
const HERON = "urn:air:heron.ing:catalog:root";

function nandaFetch(extra = {}) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://api.nandaindex.org/api/v1/index?")) {
      return new Response(JSON.stringify(RECORDS), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (extra[String(url)]) {
      return extra[String(url)]();
    }
    throw new TypeError("Failed to fetch");
  };
  return { fetchImpl, seen };
}

test("NANDA: a record is found by URL host, by urn:air: id, by orgId and by name", () => {
  assert.equal(matchNanda(RECORDS, { url: "https://heronnanda.up.railway.app/" }).identifier, HERON);
  assert.equal(matchNanda(RECORDS, { id: HERON }).displayName, "Heron A2A Checker");
  assert.equal(matchNanda(RECORDS, { id: "travel26" }).identifier, "urn:air:travel26.net:catalog:root");
  assert.equal(matchNanda(RECORDS, { id: "heron a2a checker" }).identifier, HERON);
  assert.equal(matchNanda(RECORDS, { url: "https://agent402.tools/api/weather-forecast" }), null);
});

test("NANDA: cardValidation null reads 'NANDA: listed, card not validated'; a validated card says so with its date", () => {
  const heron = nandaSummary(RECORDS.find((r) => r.identifier === HERON));
  assert.equal(heron.cardValidation, null);
  assert.equal(heron.line, "NANDA: listed, card not validated");
  const valid = nandaSummary(RECORDS.find((r) => r.identifier === "urn:air:transparent.ruhr:agent:transparent-ruhr"));
  assert.equal(valid.line, "NANDA: listed, card valid (2026-11-18)");
  const notChecked = nandaSummary(RECORDS.find((r) => r.identifier === "urn:air:faithnet.io:catalog:root"));
  assert.equal(notChecked.line, "NANDA: listed, card not validated (not_checked)");
});

test("NANDA: lookupNanda reads the list with limit and offset, and says not listed when nothing matches", async () => {
  const { fetchImpl, seen } = nandaFetch();
  const listed = await lookupNanda(fetchImpl, { id: HERON });
  assert.equal(listed.status, "listed");
  assert.deepEqual(seen, ["https://api.nandaindex.org/api/v1/index?limit=200&offset=0"]);
  const none = await lookupNanda(fetchImpl, { url: "https://nobody.example/" });
  assert.equal(none.status, "not_listed");
  assert.match(nandaLine(none), /not listed \(4 records searched\)/);
  const down = await lookupNanda(async () => { throw new TypeError("Failed to fetch"); }, { id: HERON });
  assert.equal(down.status, "unavailable");
});

test("NANDA: a check named by a NANDA name checks the record's URL, and the card data and AgentFacts carry the one record", async () => {
  const { fetchImpl, seen } = nandaFetch();
  const t = await resolveTarget({ nanda: "Heron A2A Checker" }, fetchImpl);
  assert.equal(t.ok, true);
  assert.equal(t.url, "https://heronnanda.up.railway.app/");
  const r = await gateCheck({ url: t.url, nanda: t.nanda }, { fetch: fetchImpl, timeoutMs: 2000 });
  assert.equal(r.nanda.record.identifier, HERON);
  assert.equal(r.agentFacts.x_factgate_nanda.line, "NANDA: listed, card not validated");
  assert.equal(r.agentFacts.x_factgate_nanda.record.identifier, HERON);
  // NANDA is shown, never counted: the site is unreachable here, so the verdict is CAUTION.
  assert.equal(r.verdict, "CAUTION");
  // The NANDA list was read once (for the name), not again for the URL.
  assert.equal(seen.filter((u) => u.startsWith("https://api.nandaindex.org")).length, 1);
  const missing = await resolveTarget({ nanda: "no such agent" }, fetchImpl);
  assert.equal(missing.ok, false);
  assert.equal(missing.field, "nanda");
});

test("NANDA: manifest_inspector's read (inspect_manifest) looks the URL up in NANDA, after the card", async () => {
  const { fetchImpl } = nandaFetch();
  const cards = [];
  const out = await inspectManifestRead({ url: "https://heronnanda.up.railway.app/" }, fetchImpl, { ask: async (req) => { cards.push(req.rows.map((x) => x.host)); return "once"; } });
  assert.deepEqual(cards[0], ["heronnanda.up.railway.app", "api.nandaindex.org"]);
  assert.equal(out.nanda.status, "listed");
  assert.equal(out.nanda.line, "NANDA: listed, card not validated");
});
