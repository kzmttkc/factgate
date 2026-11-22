// NANDA Index lookup (https://api.nandaindex.org/api/v1/index), read 2026-11-22: the endpoint
// returns a JSON array of records, 100 by default, `limit` up to at least 200 and `offset` to page
// (the total is in X-Total-Count, which a browser cannot read: no Access-Control-Expose-Headers).
// It answers with Access-Control-Allow-Origin set to the caller's origin, so a page can read it.
// There is no search parameter, so FactGate reads the list and matches here.
//
// A record looks like { identifier: "urn:air:…", displayName, type, url, description,
// publisher: { identifier, displayName, identityType }, extensions: { "org.projectnanda": { orgId,
// status, domain, domainVerified, emailVerified, cardValidation: null | { status, checkedAt,
// detail } } } }. A listing says the agent is in the index; cardValidation null means NANDA did
// not validate its card. Neither is used in FactGate's verdict: it is shown, not counted.
import { parseJson, readText, timedFetch } from "./net.mjs";

export const NANDA_INDEX = "https://api.nandaindex.org/api/v1/index";
const PAGE = 200;
const MAX_PAGES = 5;

function hostOf(url) {
  try {
    return new URL(String(url)).host.toLowerCase();
  } catch {
    return null;
  }
}

function ext(record) {
  return (record && record.extensions && record.extensions["org.projectnanda"]) || {};
}

// cardValidation.status values seen on 2026-11-22: valid, invalid, not_checked, unavailable (and null).
function cardLine(cv) {
  const date = cv && cv.checkedAt ? ` (${String(cv.checkedAt).slice(0, 10)})` : "";
  if (!cv || !cv.status) {
    return "NANDA: listed, card not validated";
  }
  if (cv.status === "valid" || cv.status === "invalid") {
    return `NANDA: listed, card ${cv.status}${date}`;
  }
  return `NANDA: listed, card not validated (${cv.status})`;
}

/**
 * The few fields FactGate shows of one NANDA record, with the line for the card.
 */
export function nandaSummary(record) {
  const x = ext(record);
  const cv = x.cardValidation && typeof x.cardValidation === "object" ? { status: String(x.cardValidation.status || ""), checkedAt: x.cardValidation.checkedAt || null, detail: x.cardValidation.detail || null } : null;
  return {
    identifier: record.identifier || null,
    displayName: record.displayName || null,
    type: record.type || null,
    url: record.url || null,
    orgId: x.orgId || null,
    status: x.status || null,
    domain: x.domain || null,
    domainVerified: x.domainVerified === true,
    cardValidation: cv,
    line: cardLine(cv),
  };
}

/**
 * Find one record for a URL (by host) or for a NANDA id / orgId / name.
 *
 * :param records: The index list.
 * :param query: { url } or { id }.
 * :return: The record, or null.
 */
export function matchNanda(records, query) {
  const list = Array.isArray(records) ? records.filter((r) => r && typeof r === "object") : [];
  if (query.url) {
    const host = hostOf(query.url);
    if (!host) {
      return null;
    }
    const exact = list.find((r) => typeof r.url === "string" && r.url.replace(/\/$/, "") === String(query.url).replace(/\/$/, ""));
    return exact || list.find((r) => hostOf(r.url) === host) || list.find((r) => String(ext(r).domain || "").toLowerCase() === host) || null;
  }
  const id = String(query.id || "").trim();
  if (!id) {
    return null;
  }
  const lower = id.toLowerCase();
  return list.find((r) => r.identifier === id)
    || list.find((r) => String(ext(r).orgId || "").toLowerCase() === lower)
    || list.find((r) => String(r.displayName || "").toLowerCase() === lower)
    || null;
}

/**
 * Look up a counterparty in the NANDA Index. Read-only GET requests to api.nandaindex.org.
 *
 * :param fetchImpl: The fetch to use (the page's gated fetch asks the visitor first).
 * :param query: { url } or { id } (a NANDA identifier such as urn:air:…, an orgId or a name).
 * :return: { status: "listed" | "not_listed" | "unavailable", query, record?, error?, http[] }
 */
export async function lookupNanda(fetchImpl, query, timeoutMs) {
  const http = [];
  const records = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${NANDA_INDEX}?limit=${PAGE}&offset=${page * PAGE}`;
    const got = await timedFetch(fetchImpl, url, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
    if (!got.ok) {
      http.push({ method: "GET", url, error: got.error });
      return { status: "unavailable", query, error: got.error, http };
    }
    http.push({ method: "GET", url, status: got.response.status });
    const list = got.response.status === 200 ? parseJson(await readText(got.response, 4 * 1024 * 1024)) : null;
    if (!Array.isArray(list)) {
      return { status: "unavailable", query, error: `NANDA Index HTTP ${got.response.status}${list === null ? "" : ", not a list"}`, http };
    }
    records.push(...list);
    const found = matchNanda(list, query);
    if (found) {
      return { status: "listed", query, record: nandaSummary(found), searched: records.length, http };
    }
    if (list.length < PAGE) {
      break;
    }
  }
  return { status: "not_listed", query, searched: records.length, http };
}

/** One line for the card and the gate log. */
export function nandaLine(nanda) {
  if (!nanda) {
    return "NANDA: not looked up";
  }
  if (nanda.status === "listed") {
    return `${nanda.record.line}: ${nanda.record.displayName || nanda.record.identifier}`;
  }
  if (nanda.status === "not_listed") {
    return `NANDA: not listed (${nanda.searched} records searched)`;
  }
  return `NANDA: not read (${nanda.error})`;
}
