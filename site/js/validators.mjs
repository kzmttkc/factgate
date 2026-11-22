// Whose ERC-8004 validation scores FactGate counts (pillar 3, second source).
//
// Rule: a score counts only when its validator is on the trusted list for that chain. The default
// list holds only validators whose every score anyone can re-compute from public records. A score
// from a validator that is not on the list is shown, never counted (it can neither pass nor block
// a counterparty). A self-score (validator = the agent's owner or agentWallet) never counts, even
// from a listed validator. The visitor can change the list on the page; site/validators.json
// publishes the default, and test/rules.test.mjs checks the two agree.

export const DEFAULT_VALIDATORS = Object.freeze([
  Object.freeze({
    address: "0x5ec4599a438fa0559ade8b8551b369d5c5adf0bc",
    chains: Object.freeze([84532]),
    name: "Delivery Court judge",
    operator: "the FactGate author (this is the author's own validator)",
    reproduce: "Every score names its record (responseURI) and the exact body it judged (sha256 = responseHash). offchain/src/rejudge.mjs in the public Delivery Court repository (github.com/kzmttkc/reactive-delivery-court) re-reads the validationResponse call, checks the body hash and re-runs the model files to recompute the score.",
  }),
]);

function normAddress(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^0x[0-9a-f]{40}$/.test(v) ? v : null;
}

/**
 * Clean a trusted-validator list: addresses lower-cased, chains as numbers, bad rows dropped.
 *
 * :param list: An array of { address, chains?, name? }. chains missing or empty means any chain.
 * :return: The cleaned list.
 */
export function normalizeTrusted(list) {
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    const address = normAddress(row && row.address);
    if (!address) {
      continue;
    }
    const chains = Array.isArray(row.chains) ? row.chains.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    out.push({ address, chains, name: typeof row.name === "string" ? row.name : address });
  }
  return out;
}

/**
 * Find the trusted-list row for a validator on a chain.
 *
 * :return: The row, or null when the validator is not trusted there.
 */
export function trustedRow(trusted, validator, chainId) {
  const v = normAddress(validator);
  if (!v) {
    return null;
  }
  for (const row of normalizeTrusted(trusted)) {
    if (row.address === v && (row.chains.length === 0 || row.chains.includes(Number(chainId)))) {
      return row;
    }
  }
  return null;
}
