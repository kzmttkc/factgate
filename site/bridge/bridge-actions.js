// The reads FactGate shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. When another site's assistant
// calls FactGate, the bridge loads it in a hidden frame on this origin, which has no page.
// Only names in the manifest's "actions.agentTools" reach a partner's agents.
// Every action here only reads (GET, MCP tools/list, eth_call, vet402's read tool), so every
// site may call it. Saved checks stay on FactGate's own page and are not shared.
import { evaluateGate, gateRules, pillarsFromArgs } from "../js/gate.mjs";
import { DESCRIPTIONS, SCHEMAS, gateCheckRead, inspectManifestRead, probeCapabilitiesRead, readIdentityRead } from "../js/reads.mjs";
import { PILLAR_PROPS } from "../js/schema.mjs";

function bridgeFetch(url, init) {
  return globalThis.fetch(url, init);
}

class BridgeActions {
  /**
   * "*" shares these reads with every site. They read no visitor data: only public answers
   * from the counterparty, the chain and vet402, and pure functions of the caller's input.
   */
  static CALLERS = ["*"];

  static registerActions(actions) {
    actions.register(BridgeActions.readStateAction());
    actions.register(BridgeActions.read("gate_check", SCHEMAS.gateCheck, BridgeActions.gateCheck));
    actions.register(BridgeActions.read("inspect_manifest", SCHEMAS.target, (a) => inspectManifestRead(a, bridgeFetch)));
    actions.register(BridgeActions.read("probe_capabilities", SCHEMAS.target, (a) => probeCapabilitiesRead(a, bridgeFetch)));
    actions.register(BridgeActions.read("read_identity", SCHEMAS.gateCheck, (a) => readIdentityRead(a, bridgeFetch)));
    actions.register(BridgeActions.evaluateAction());
  }

  static read(name, inputSchema, execute) {
    return {
      name,
      description: `${DESCRIPTIONS[name]} Changes nothing.`,
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema,
      execute,
    };
  }

  /**
   * gate_check(target) for partner sites: the verdict, the reasons and the values read. The full
   * AgentFacts with every HTTP request stays on FactGate's page; the summary says so.
   */
  static async gateCheck(args) {
    const r = await gateCheckRead(args, bridgeFetch);
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
