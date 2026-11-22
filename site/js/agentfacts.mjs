// AgentFacts output: what FactGate measured about a counterparty, in the field names of the
// AgentFacts paper, with the three pillars attached as evidence.
//
// Format source: arXiv:2507.14263 v1 (Raskar et al., "Beyond DNS: Unlocking the Internet of AI
// Agents via the NANDA Index and Verified AgentFacts"), Appendix "Full AgentFacts Schema",
// marked "V0.3, Work in Progress, Request for Comments. Draft". The paper says AgentFacts are
// JSON-LD but its example has no @context and names no context URL, and
// spec.projectnanda.org does not resolve, so this output has no @context.
// FactGate's own fields start with "x_factgate_" so they read as extensions.
// The paper requires AgentFacts to be signed by an authorized issuer. FactGate is not one and
// signs nothing: x_factgate_signature says so, and there is no "certification" field.

export const AGENTFACTS_FIELDS = Object.freeze([
  "id",
  "agent_name",
  "label",
  "description",
  "version",
  "documentationUrl",
  "jurisdiction",
  "provider",
  "endpoints",
  "capabilities",
  "skills",
  "evaluations",
  "telemetry",
  "certification",
]);

export const AGENTFACTS_SOURCE = "arXiv:2507.14263v1, Appendix 'Full AgentFacts Schema' (V0.3 draft)";

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function dropUndefined(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) {
      delete obj[k];
    }
  }
  return obj;
}

function urnPart(s) {
  return String(s).trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._~-]/g, "");
}

/**
 * Which ERC-8004 validators' scores were counted and which were not, with the reason, and the
 * trusted list used. Undefined when no validation record was read.
 */
function validatorsBlock(input) {
  const v = input.delivery && input.delivery.validation;
  const data = v && v.status === "ok" ? v.data : null;
  if (!data) {
    return undefined;
  }
  return {
    rule: "A score counts only when its validator is on the trusted list for that chain; self-scores never count.",
    trustedList: clone((input.trustedValidators || []).map((t) => ({ address: t.address, chains: t.chains, name: t.name }))),
    counted: clone(data.counted || []),
    notCounted: clone(data.notCounted || []),
  };
}

/**
 * :param input: { url, checkedAt, verdict: {verdict, reasons}, live: {pillar, declared, http, checks?},
 *   identity: {pillar, agent?, rpc?, binding?, ...}, delivery: {pillar, ...} }
 * :return: a plain JSON object.
 */
export function buildAgentFacts(input) {
  const url = input.url;
  const live = input.live || {};
  const declared = live.declared || {};
  const identity = input.identity || {};
  const reg = declared.registrationFile && typeof declared.registrationFile === "object" ? declared.registrationFile : null;
  const entry = declared.manifestEntry || null;
  let host = url;
  let origin = url;
  let hostname = url;
  let port = "";
  try {
    const u = new URL(url);
    host = u.host;
    origin = u.origin;
    // hostname and port apart, so "127.0.0.1:8792" keeps its ":" (urnPart drops other punctuation).
    hostname = u.hostname;
    port = u.port;
  } catch {
    // keep the raw value
  }

  const onChain = identity.pillar && identity.pillar.status === "ok" && identity.pillar.data && identity.pillar.data.registered && identity.agent;
  const id = onChain ? `eip155:${identity.agent.chainId}:${identity.agent.registry}:${identity.agent.agentId}` : url;
  const label = (reg && reg.name) || (entry && entry.name) || host;

  const endpoints = [url];
  for (const m of Array.isArray(declared.mcp) ? declared.mcp : []) {
    if (m && m.url && !endpoints.includes(m.url)) {
      endpoints.push(m.url);
    }
  }

  const capabilities = {};
  if (declared.terms && Array.isArray(declared.terms.accepts) && declared.terms.accepts.length) {
    capabilities.authentication = { methods: ["x402"] };
  }

  const skillIds = [];
  for (const m of Array.isArray(declared.mcp) ? declared.mcp : []) {
    const names = m && Array.isArray(m.tools) && m.tools.length ? m.tools : m && Array.isArray(m.listed) ? m.listed : [];
    for (const n of names) {
      if (!skillIds.includes(n)) {
        skillIds.push(n);
      }
    }
  }
  let skills = skillIds.slice(0, 20).map((n) => ({ id: n }));
  if (skills.length === 0 && entry && entry.name) {
    skills = [dropUndefined({ id: entry.name, description: entry.description })];
  }

  const verdict = input.verdict || {};
  return dropUndefined({
    id,
    agent_name: `urn:agent:${urnPart(hostname)}${port ? `:${port}` : ""}:${urnPart(label)}`,
    label,
    description: (reg && reg.description) || (entry && entry.description) || undefined,
    provider: { url: origin },
    endpoints: { static: endpoints },
    capabilities,
    skills,
    evaluations: {
      lastAudited: input.checkedAt,
      auditorID: "FactGate verdict engine (site/js/gate.mjs): deterministic, no LLM, unsigned",
    },
    x_factgate_verdict: {
      verdict: verdict.verdict,
      reasons: clone(verdict.reasons) || [],
      notApplicable: (verdict.reasons || []).filter((r) => r.applicable === false).map((r) => `${r.pillar}: not applicable (not a pass)`),
    },
    x_factgate_unofficial_registries: identity.unofficial && identity.unofficial.length ? clone(identity.unofficial) : undefined,
    x_factgate_validators: validatorsBlock(input),
    // One NANDA Index record for this counterparty, as listed (shown, not used in the verdict).
    x_factgate_nanda: input.nanda
      ? (input.nanda.status === "listed"
        ? { status: "listed", source: "https://api.nandaindex.org/api/v1/index", line: input.nanda.record.line, record: clone(input.nanda.record) }
        : { status: input.nanda.status, source: "https://api.nandaindex.org/api/v1/index", error: input.nanda.error, searched: input.nanda.searched })
      : undefined,
    x_factgate_evidence: {
      target: url,
      checkedAt: input.checkedAt,
      live: clone(live),
      identity: clone(identity),
      delivery: clone(input.delivery),
    },
    x_factgate_signature: {
      signed: false,
      note: "FactGate is not an issuer under the NANDA trust framework and does not sign. Re-run the check to verify; every value has its source URL in x_factgate_evidence.",
    },
    x_factgate_format: {
      source: AGENTFACTS_SOURCE,
      note: "No @context: the paper calls AgentFacts JSON-LD but gives no context URL. Fields starting with x_factgate_ are FactGate extensions.",
    },
  });
}
