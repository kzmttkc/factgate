// Pillar 1, static check of the instructions a caller would load (MVP spec section 5,
// "Untrusted instructions"): a peer network's agent instructions run inside the caller's model.
// This reads the published network definition (no model, no execution) and flags text that
// tries to steer the caller's model:
//   - override:  tells the model to ignore or replace the caller's rules            -> CAUTION
//   - extract:   asks the model to reveal its prompt, history or private context    -> CAUTION
//   - redirect:  sends the caller to a site the network does not declare            -> CAUTION
//   - secret:    asks for a key, password, seed phrase or token                      -> BLOCK
// It works sentence by sentence, and a sentence that forbids the thing ("Never ask for
// passwords") is not a finding, so ordinary grounding rules pass. test/instructions.test.mjs
// runs it over FactGate's, the demo sites' and the reference examples' networks (no finding)
// and over planted bad lines (each found).

const NEGATION = /\b(never|not|no|don't|dont|doesn't|cannot|can't|mustn't|refuse|refuses|without|avoid|instead of)\b/i;

// A finding needs its verb not to be negated: no negation word in the 48 characters before the
// verb. "Never ask for passwords" is a rule, "Ask for the API key; it is not stored" is not.
function negatedBefore(sentence, index) {
  return NEGATION.test(sentence.slice(Math.max(0, index - 48), index));
}

function firstUnnegated(sentence, verbRe) {
  const re = new RegExp(verbRe.source, "gi");
  let m;
  while ((m = re.exec(sentence)) !== null) {
    if (!negatedBefore(sentence, m.index)) {
      return m.index;
    }
  }
  return -1;
}

const RULES = [
  {
    rule: "secret",
    severity: "block",
    verb: /\b(ask|asks|request|requests|collect|send|share|provide|paste|enter|type|give|reveal|forward|include|tell|submit|copy|read out)\b/,
    object: /\b(private keys?|seed phrases?|recovery phrases?|mnemonics?|api[- ]?keys?|secret keys?|access tokens?|bearer tokens?|auth(?:orization)? tokens?|passwords?|passcodes?|byok keys?|authorization headers?)\b|\bsk-[a-z0-9]/i,
  },
  {
    rule: "override",
    severity: "caution",
    verb: /\b(ignore|disregard|forget|override|bypass|replace|drop)\b/,
    object: /\b(previous|prior|above|earlier|all|any|other|system|caller'?s?|calling|site'?s|original|existing|safety|your)\b[^.]{0,40}\b(instructions?|rules?|polic(?:y|ies)|prompts?|guidelines?|guardrails?)\b/i,
  },
  {
    rule: "override",
    severity: "caution",
    verb: /\b(you are no longer|these instructions (?:take precedence|override|replace)|my instructions (?:take precedence|override|replace))\b/,
    object: /./,
  },
  {
    rule: "extract",
    severity: "caution",
    verb: /\b(reveal|repeat|print|output|show|dump|send|share|forward|return)\b/,
    object: /\b(system prompt|your (?:own )?instructions|hidden instructions|conversation history|chat history|previous messages|private context|sly_data|other tools'? results)\b/i,
  },
];

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;
const REDIRECT_VERB = /\b(call|contact|hand off|handoff|send|forward|post|visit|go to|redirect|use|load|fetch|connect to|report to)\b/;

function originOf(u) {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

function expand(text, strings) {
  return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (m, key) => (Object.hasOwn(strings, key) ? String(strings[key]) : m));
}

/**
 * The texts a caller's model would read from a network definition: each agent's instructions
 * (with commondefs.replacement_strings expanded once, as the runtime does) and its function
 * description.
 *
 * :param network: The parsed network definition JSON.
 * :return: [{ agent, field, text }]
 */
export function instructionTexts(network) {
  const strings = network && network.commondefs && network.commondefs.replacement_strings && typeof network.commondefs.replacement_strings === "object" ? network.commondefs.replacement_strings : {};
  const out = [];
  for (const a of network && Array.isArray(network.tools) ? network.tools : []) {
    if (!a || typeof a !== "object") {
      continue;
    }
    const name = typeof a.name === "string" ? a.name : "(unnamed agent)";
    if (typeof a.instructions === "string") {
      out.push({ agent: name, field: "instructions", text: expand(a.instructions, strings) });
    }
    const desc = a.function && typeof a.function.description === "string" ? a.function.description : null;
    if (desc) {
      out.push({ agent: name, field: "function.description", text: expand(desc, strings) });
    }
  }
  return out;
}

/** Split text into sentences and lines. */
export function sentences(text) {
  return String(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Scan a network definition's instructions.
 *
 * :param network: The parsed network definition.
 * :param options: { siteUrl, declaredUrls[] }: origins the network may name without being a
 *   redirect (the site itself and the peers and MCP servers it declares in tools).
 * :return: { scanned, findings: [{ agent, field, rule, severity, excerpt }] }
 */
export function scanInstructions(network, { siteUrl = null, declaredUrls = [] } = {}) {
  const allowedOrigins = new Set([siteUrl, ...declaredUrls].map(originOf).filter(Boolean));
  const findings = [];
  const texts = instructionTexts(network);
  for (const t of texts) {
    for (const s of sentences(t.text)) {
      const seen = new Set();
      for (const r of RULES) {
        const at = firstUnnegated(s, r.verb);
        if (at >= 0 && r.object.test(s.slice(at)) && !seen.has(r.rule)) {
          seen.add(r.rule);
          findings.push({ agent: t.agent, field: t.field, rule: r.rule, severity: r.severity, excerpt: s.slice(0, 160) });
        }
      }
      const urls = s.match(URL_RE) || [];
      if (urls.length && firstUnnegated(s, REDIRECT_VERB) >= 0) {
        const strangers = urls.filter((u) => {
          const o = originOf(u);
          return o && !allowedOrigins.has(o);
        });
        if (strangers.length) {
          findings.push({ agent: t.agent, field: t.field, rule: "redirect", severity: "caution", excerpt: s.slice(0, 160) });
        }
      }
    }
  }
  return { scanned: texts.length, findings };
}
