// The reads FactGate shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. Only names in the manifest's
// "actions.agentTools" reach a partner's agents. Saved checks stay on FactGate's own page.
//
// get_gate_state and evaluate_gate contact nothing, so they run in the bridge's hidden frame.
// gate_check contacts the counterparty, a chain RPC and vet402.com. It must ask the visitor first
// (MVP spec 3.2 Consent, section 5), and a hidden frame cannot ask. The reference runtime opens a
// partner's own window only for an action marked "write" (runtime/action-transport.js), so
// gate_check is marked "write" with confirmsInWindow: the calling page opens a FactGate window
// (its chat asks the visitor first), and there FactGate shows its consent card listing each
// origin and what it would send there. gate_check changes nothing anywhere.
import { askInPage } from "../js/consent-card.mjs";
import { evaluateGate, gateRules, pillarsFromArgs } from "../js/gate.mjs";
import { DESCRIPTIONS, SCHEMAS, gateCheckRead } from "../js/reads.mjs";
import { PILLAR_PROPS } from "../js/schema.mjs";
import { DEFAULT_VALIDATORS, normalizeTrusted } from "../js/validators.mjs";

function bridgeFetch(url, init) {
  return globalThis.fetch(url, init);
}

class BridgeActions {
  /**
   * "*" shares these reads with every site. They read no visitor data: only public answers
   * from the counterparty, the chain and vet402, and pure functions of the caller's input.
   */
  static CALLERS = ["*"];

  /**
   * Who answers FactGate's consent card in its window. Tests replace it; in a browser it is the
   * card in js/consent-card.mjs, shown in FactGate's own window.
   */
  static consent = (request) => askInPage(request, { intro: "Another site's assistant asked FactGate to check a counterparty. Nothing has been sent yet. Each origin below gets only what is listed. FactGate never pays, signs or sends a key." });

  static registerActions(actions) {
    actions.register(BridgeActions.readStateAction());
    actions.register(BridgeActions.gateCheckAction());
    actions.register(BridgeActions.evaluateAction());
  }

  static gateCheckAction() {
    return {
      name: "gate_check",
      description: `${DESCRIPTIONS.gate_check} It opens in a FactGate window, where the visitor approves each origin first; call it once per counterparty. It changes nothing: it is marked write only so the runtime opens that window.`,
      effect: "write",
      availability: "bridge",
      confirmsInWindow: true,
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: SCHEMAS.gateCheck,
      execute: BridgeActions.gateCheck,
    };
  }

  /**
   * The visitor's trusted-validator list on FactGate's origin (set on FactGate's page), else
   * the published default.
   */
  static trustedValidators() {
    try {
      const saved = globalThis.localStorage?.getItem("factgate.trustedValidators.v1");
      const list = saved ? normalizeTrusted(JSON.parse(saved)) : [];
      return list.length ? list : normalizeTrusted(DEFAULT_VALIDATORS);
    } catch {
      return normalizeTrusted(DEFAULT_VALIDATORS);
    }
  }

  /**
   * gate_check(target) for partner sites: the verdict, the reasons and the values read, after the
   * visitor's card. The full AgentFacts with every HTTP request stays on FactGate's page.
   */
  static async gateCheck(args) {
    const r = await gateCheckRead(args, bridgeFetch, { ask: (request) => BridgeActions.consent(request), remembered: new Set(), trustedValidators: BridgeActions.trustedValidators() });
    return r.ok === false ? r : r.summary;
  }

  static readStateAction() {
    return {
      name: "get_gate_state",
      description: "Read FactGate's rules and its three pillars. Saved checks stay on FactGate's own page and are not shared. Changes nothing.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: BridgeActions.readState,
    };
  }

  static readState() {
    return { ...gateRules(), checks: [] };
  }

  static evaluateAction() {
    return {
      name: "evaluate_gate",
      description: "Run FactGate's deterministic verdict engine on three pillar results you already have and return {verdict: ALLOW|CAUTION|BLOCK, reasons}. Prefer gate_check, which measures the pillars itself. A pillar you could not fetch is {status: \"unavailable\", error}. Changes nothing.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: PILLAR_PROPS,
      },
      execute: BridgeActions.evaluate,
    };
  }

  static evaluate(args) {
    const result = evaluateGate(pillarsFromArgs(args));
    return { ok: true, verdict: result.verdict, reasons: result.reasons };
  }
}

export const registerActions = BridgeActions.registerActions;
// Exported so a test can answer the consent card (BridgeActions.consent).
export { BridgeActions };
