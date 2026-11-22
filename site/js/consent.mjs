// Consent before contact (MVP spec 3.2 "Consent", section 5 "Explicit destinations" and
// "Consent before contact"). Every request a FactGate check sends goes through a gated fetch:
// a request to an origin the visitor has not approved is not sent. The check runs in rounds.
// Each round records which origins it wanted and why; the visitor sees one card that lists
// them with their purposes; approved origins are contacted in the next round, declined ones
// never. So the first card names only the counterparty's own origin, and the second card
// names what reading it showed is needed (chain RPC, vet402.com, MCP servers it declares).
//
// A remembered approval ("Allow for this visit") is kept per origin for the page session, and
// only when the visitor chose it (spec 3.2: any relaxation must be an explicit choice).

const NULL_BODY = new Set([101, 103, 204, 205, 304]);
const MAX_PATHS = 4;

function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return String(origin);
  }
}

function parseBody(init) {
  if (!init || typeof init.body !== "string") {
    return null;
  }
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

/**
 * Say in plain words why a request would be sent. Never includes header values.
 *
 * :param url: The request URL.
 * :param init: The fetch options.
 * :return: A short purpose, such as "MCP initialize and tools/list (lists tools, calls none)".
 */
export function purposeOf(url, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const body = parseBody(init);
  const calls = Array.isArray(body) ? body : body ? [body] : [];
  const rpcMethods = [...new Set(calls.map((c) => c && c.method).filter((m) => typeof m === "string"))];
  if (rpcMethods.length && rpcMethods.every((m) => m.startsWith("eth_"))) {
    return "read ERC-8004 records on chain (JSON-RPC eth_call / eth_getLogs, no transaction)";
  }
  if (rpcMethods.includes("tools/call")) {
    const name = calls.find((c) => c && c.method === "tools/call")?.params?.name || "a tool";
    return `MCP tools/call ${name} (a read-only record lookup)`;
  }
  if (rpcMethods.some((m) => m === "initialize" || m === "tools/list" || m.startsWith("notifications/"))) {
    return "MCP initialize and tools/list (lists its tools, calls none)";
  }
  if (method === "GET") {
    let path = "/";
    try {
      path = new URL(String(url)).pathname;
    } catch {
      // keep "/"
    }
    return `GET ${path}`;
  }
  return `${method} request`;
}

/**
 * Merge request purposes for one card row: GET paths collapse into one line.
 *
 * :param purposes: The purposes recorded for one origin.
 * :return: The purposes to show.
 */
export function summarizePurposes(purposes) {
  const gets = [];
  const other = [];
  for (const p of purposes) {
    if (p.startsWith("GET ")) {
      gets.push(p.slice(4));
    } else if (!other.includes(p)) {
      other.push(p);
    }
  }
  const out = [];
  if (gets.length) {
    const shown = gets.slice(0, MAX_PATHS).join(", ");
    out.push(`read public files (GET ${shown}${gets.length > MAX_PATHS ? `, +${gets.length - MAX_PATHS} more` : ""}; no payment, no credentials)`);
  }
  return [...out, ...other];
}

async function cachedResponse(entry) {
  return new Response(NULL_BODY.has(entry.status) ? null : entry.text, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
}

/**
 * Run an operation that takes a fetch function, asking the visitor before each new origin.
 *
 * :param run: async (fetch) => result. It is run once per round with a gated fetch.
 * :param options: { fetch, ask, remembered?, maxRounds? }
 *   ask: async ({ rows: [{ origin, host, purposes[] }], round }) => "once" | "visit" | "decline"
 *   remembered: a Set of origins approved "for this visit"; approvals chosen so are added.
 * :return: { result, consent: { cards, approved, declined, unasked } }
 */
export async function withConsent(run, { fetch: fetchImpl, ask, remembered = new Set(), maxRounds = 5 }) {
  if (typeof ask !== "function") {
    throw new Error("withConsent needs an ask function: FactGate contacts nothing without the visitor's approval.");
  }
  const approved = new Set(remembered);
  const declined = new Set();
  const cache = new Map();
  const cards = [];
  let result = null;
  let wanted = new Map();
  for (let round = 0; round < maxRounds; round += 1) {
    wanted = new Map();
    const gated = async (url, init = {}) => {
      const origin = originOf(url);
      if (!origin) {
        throw new TypeError(`not contacted: ${String(url)} is not a URL`);
      }
      if (declined.has(origin)) {
        throw new TypeError(`not contacted: the visitor declined ${hostOf(origin)}`);
      }
      if (!approved.has(origin)) {
        const list = wanted.get(origin) || [];
        list.push(purposeOf(url, init));
        wanted.set(origin, list);
        throw new TypeError(`not contacted yet: ${hostOf(origin)} needs the visitor's approval`);
      }
      const method = String(init.method || "GET").toUpperCase();
      const key = `${method} ${String(url)} ${typeof init.body === "string" ? init.body : ""}`;
      if (cache.has(key)) {
        return cachedResponse(cache.get(key));
      }
      const response = await fetchImpl(url, init);
      if (method !== "GET" && response.status !== 200) {
        return response;
      }
      const text = NULL_BODY.has(response.status) ? "" : await response.text();
      const entry = { status: response.status, statusText: response.statusText, headers: new Headers(response.headers), text };
      cache.set(key, entry);
      return cachedResponse(entry);
    };
    result = await run(gated);
    if (wanted.size === 0) {
      break;
    }
    if (round === maxRounds - 1) {
      break;
    }
    const rows = [...wanted.entries()].map(([origin, purposes]) => ({ origin, host: hostOf(origin), purposes: summarizePurposes(purposes) }));
    const answer = await ask({ rows, round: cards.length + 1 });
    cards.push({ rows, answer: answer === "visit" || answer === "once" ? answer : "decline" });
    for (const row of rows) {
      if (answer === "once" || answer === "visit") {
        approved.add(row.origin);
        if (answer === "visit") {
          remembered.add(row.origin);
        }
      } else {
        declined.add(row.origin);
      }
    }
  }
  return {
    result,
    consent: {
      cards,
      approved: [...approved],
      declined: [...declined],
      unasked: [...wanted.keys()],
    },
  };
}
