// CRUSE presentation for a FactGate gate_check result (spec §7 CRUSE generative interfaces).
import { verdictCard } from "./card.mjs";

/**
 * :param result: a full gateCheck() result (with evidence for delivery freshness).
 * :return: { version: 1, components: [...] } for render_cruse.
 */
export function cruseVerdictPresentation(result) {
  const card = verdictCard(result);
  const components = [
    {
      id: "factgate-verdict",
      kind: "info",
      title: "FactGate verdict",
      fields: {
        Action: card.action,
        Verdict: card.verdict,
        Target: card.target,
        Checked: card.checkedAt,
      },
    },
    {
      id: "factgate-pillars",
      kind: "table",
      title: "Three pillars",
      columns: ["Pillar", "Result", "Summary"],
      rows: card.pillars.map((p) => [p.title, p.label, p.lastDelivered || p.line]),
    },
  ];
  const lastLine = card.pillars.find((p) => p.key === "delivery" && p.lastDelivered);
  if (lastLine && lastLine.lastDelivered) {
    components.push({
      id: "factgate-last-delivered",
      kind: "info",
      fields: { "Last delivered": lastLine.lastDelivered },
    });
  }
  return { version: 1, components };
}