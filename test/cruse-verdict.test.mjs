import assert from "node:assert/strict";
import test from "node:test";
import { cruseVerdictPresentation } from "../site/js/cruse-verdict.mjs";

const RESULT = {
  url: "https://agent402.tools/api/weather-forecast",
  checkedAt: "2026-11-23T06:00:00.000Z",
  verdict: "ALLOW",
  reasons: [
    { pillar: "live", effect: "ALLOW", code: "live_as_declared", text: "Answers as declared.", short: "Answers as declared." },
    { pillar: "identity", effect: "ALLOW", code: "identity_bound", text: "Payee matches registration.", short: "Payee matches registration." },
    { pillar: "delivery", effect: "ALLOW", code: "delivery_delivered", text: "Delivered.", short: "Delivered." },
  ],
  counts: { paid: 1, delivered: 1, validationsPassed: 79, validationsFailed: 0 },
  evidence: {
    delivery: {
      paid: true,
      pillar: {
        status: "ok",
        data: {
          evidence_age: {
            last_delivered_at: "2026-11-07T12:01:04.681Z",
            stale_after_days: 30,
            tier: "aging",
          },
        },
      },
    },
  },
};

test("cruseVerdictPresentation builds info and table components from a gate check", () => {
  const p = cruseVerdictPresentation(RESULT);
  assert.equal(p.version, 1);
  const kinds = p.components.map((c) => c.kind);
  assert.ok(kinds.includes("info"));
  assert.ok(kinds.includes("table"));
  const info = p.components.find((c) => c.id === "factgate-verdict");
  assert.equal(info.fields.Action, "Link / pay: OK");
  assert.equal(info.fields.Verdict, "ALLOW");
  const table = p.components.find((c) => c.id === "factgate-pillars");
  assert.equal(table.rows.length, 3);
  const last = p.components.find((c) => c.id === "factgate-last-delivered");
  assert.match(last.fields["Last delivered"], /2026-11-07/);
});