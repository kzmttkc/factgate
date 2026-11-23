// Collect SHA-256 digests of every HTTP response body FactGate read during a check.
import { digestHttpBody } from "./agentfacts-sign.mjs";

/**
 * :param entry: { url, status?, error?, responseBody? }
 * :param at: ISO timestamp for this check.
 */
export async function digestFromHttpEntry(entry, at, cryptoImpl = globalThis.crypto) {
  if (!entry || !entry.url || entry.responseBody === undefined) {
    return null;
  }
  return {
    url: entry.url,
    sha256: await digestHttpBody(entry.responseBody, cryptoImpl),
    status: entry.error ? entry.error : entry.status,
    at,
  };
}

export async function digestsFromHttpLog(http, at, cryptoImpl = globalThis.crypto) {
  const out = [];
  for (const h of http || []) {
    const d = await digestFromHttpEntry(h, at, cryptoImpl);
    if (d) {
      out.push(d);
    }
  }
  return out;
}

export async function mergeResponseDigests(lists, cryptoImpl = globalThis.crypto) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of list || []) {
      const key = `${item.url}\0${item.sha256}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}