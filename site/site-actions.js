// Registers FactGate's page operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
// The verdict rules live in js/gate.mjs. This file only wraps the page object.
import { App } from "./js/app.js";
import { DESCRIPTIONS, SCHEMAS } from "./js/reads.mjs";

// A measurement record made by page code in this visit (website_gate_check, website_check_seller).
const MEASUREMENT_ID = { type: "string", minLength: 3, maxLength: 20, description: "measurementId from website_gate_check or website_check_seller" };

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.read("gate_check", SCHEMAS.gateCheck, (a) => App.page.gateCheck(a)));
    actions.register(SiteActions.read("inspect_manifest", SCHEMAS.target, (a) => App.page.inspectManifest(a)));
    actions.register(SiteActions.read("probe_capabilities", SCHEMAS.target, (a) => App.page.probeCapabilities(a)));
    actions.register(SiteActions.read("read_identity", SCHEMAS.gateCheck, (a) => App.page.readIdentity(a)));
    actions.register(SiteActions.checkSellerAction());
    actions.register(SiteActions.evaluateAction());
    actions.register(SiteActions.saveCheckAction());
  }

  /**
   * One of the shared read-only checks in js/reads.mjs, run by the page so the result shows here.
   */
  static read(name, inputSchema, execute) {
    return { name, description: `${DESCRIPTIONS[name]} Changes nothing.`, effect: "read", inputSchema, execute };
  }

  static readStateAction() {
    return {
      name: "get_gate_state",
      description: "Read FactGate's rules, the three pillars and the checks saved on this page, with the page version. Call it before answering about how FactGate judges or about saved checks. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: SiteActions.readState,
    };
  }

  static readState() {
    return App.page.getState();
  }

  static checkSellerAction() {
    return {
      name: "check_seller",
      description: "Pillar 3 only: page code reads vet402's delivery record for one x402 URL. Live and identity stay unavailable; use website_gate_check for all three. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 8, maxLength: 2048, description: "The absolute https x402 URL." },
        },
      },
      execute: SiteActions.checkSeller,
    };
  }

  static checkSeller(args) {
    return App.page.checkSeller(args.url);
  }

  static evaluateAction() {
    return {
      name: "evaluate_gate",
      description: "Run the verdict engine again on one measurement page code made (the measurementId from website_gate_check or website_check_seller). It takes no pillar values. Returns {verdict, reasons}. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["measurementId"],
        properties: { measurementId: MEASUREMENT_ID },
      },
      execute: SiteActions.evaluate,
    };
  }

  static evaluate(args) {
    return App.page.evaluate(args);
  }

  static saveCheckAction() {
    return {
      name: "save_check",
      description: "Call it only when the visitor asks to keep a check. Saves the verdict of one measurement (measurementId from website_gate_check or website_check_seller) in the page's saved checks; label defaults to its URL. The visitor can remove it on the page. Returns the saved check and the new version, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["measurementId"],
        properties: {
          measurementId: MEASUREMENT_ID,
          label: { type: "string", minLength: 1, maxLength: 200, description: "Optional name for the saved check." },
        },
      },
      execute: SiteActions.saveCheck,
    };
  }

  static saveCheck(args) {
    return App.page.saveCheck(args);
  }
}

export const registerActions = SiteActions.registerActions;
