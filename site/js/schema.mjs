// Action argument schemas for the three pillars, in the runtime's JSON Schema subset:
// every object lists its fields and rejects extra ones. Shared by site-actions.js and the bridge.
const STATUS = { type: "string", enum: ["ok", "unavailable"], description: "unavailable if not fetched; never fill in zeros" };
const ERROR = { type: "string", maxLength: 500 };
const ADDRESS = { type: "string", maxLength: 42 };

export const PILLAR_PROPS = {
  live: {
    type: "object",
    description: "Pillar 1, live",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: STATUS,
      error: ERROR,
      corsReachable: { type: "boolean" },
      answersAsDeclared: { type: "string", enum: ["yes", "no", "not_compared"] },
      detail: { type: "string", maxLength: 300 },
      unreachable: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    },
  },
  identity: {
    type: "object",
    description: "Pillar 2, declared payTo vs ERC-8004 on chain",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: STATUS,
      error: ERROR,
      declaredPayTo: { ...ADDRESS },
      registered: { type: "boolean" },
      owner: { ...ADDRESS },
      agentWallet: { ...ADDRESS },
      payTo: { ...ADDRESS },
      bound: { type: "boolean" },
      declaredOnly: { type: "boolean" },
    },
  },
  delivery: {
    type: "object",
    description: "Pillar 3, vet402 check_x402_seller fields",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: STATUS,
      error: ERROR,
      recommendation: { type: "string", enum: ["ALLOW", "WARN", "BLOCK"] },
      reasonCodes: { type: "array", maxItems: 20, items: { type: "string", maxLength: 60 } },
      paidAttempts: { type: "integer", minimum: 0 },
      delivered: { type: "integer", minimum: 0 },
      settledNotDelivered: { type: "integer", minimum: 0 },
      notInCatalog: { type: "boolean" },
    },
  },
};
