// A fetch for Node that applies the browser's CORS rules to what the server actually sent, so
// scripts/probe-live.mjs measures what FactGate's page (on `origin`) can read. It sends the
// real Origin header, sends the preflight a browser would send, refuses an answer without a
// matching Access-Control-Allow-Origin (as a TypeError, like a browser), and hides response
// headers that are neither CORS-safelisted nor exposed.
// It is a measuring tool, not a way around CORS: it can only refuse more, never allow more.

const SAFE_METHODS = new Set(["GET", "HEAD", "POST"]);
const SAFE_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);
const SAFE_RESPONSE_HEADERS = new Set(["cache-control", "content-language", "content-length", "content-type", "expires", "last-modified", "pragma"]);
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function lowerHeaders(h) {
  const out = {};
  if (!h) {
    return out;
  }
  const entries = typeof h.entries === "function" ? [...h.entries()] : Object.entries(h);
  for (const [k, v] of entries) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

/** Request headers a browser would put in Access-Control-Request-Headers. */
export function unsafeRequestHeaders(headers) {
  const out = [];
  for (const [k, v] of Object.entries(headers)) {
    if (k === "accept" || k === "accept-language" || k === "content-language") {
      continue;
    }
    if (k === "content-type" && SAFE_CONTENT_TYPES.has(v.split(";")[0].trim().toLowerCase())) {
      continue;
    }
    out.push(k);
  }
  return out.sort();
}

function listHeader(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function originAllowed(res, origin) {
  const acao = res.headers.get("access-control-allow-origin");
  return acao === "*" || acao === origin;
}

/**
 * :param origin: the page origin to act as, such as "http://localhost:8790".
 * :param baseFetch: the real fetch (Node's global fetch by default).
 */
export function corsFetch({ origin, baseFetch = globalThis.fetch }) {
  return async function fetchAsBrowser(url, init = {}) {
    const target = new URL(url);
    const method = String(init.method || "GET").toUpperCase();
    const headers = lowerHeaders(init.headers);
    delete headers.origin;
    if (target.origin === origin) {
      return baseFetch(url, { ...init, headers });
    }
    const unsafe = unsafeRequestHeaders(headers);
    if (!SAFE_METHODS.has(method) || unsafe.length > 0) {
      const pre = await baseFetch(url, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": method, ...(unsafe.length ? { "Access-Control-Request-Headers": unsafe.join(",") } : {}) },
        signal: init.signal,
      });
      if (pre.status < 200 || pre.status > 299 || !originAllowed(pre, origin)) {
        throw new TypeError(`CORS preflight refused: OPTIONS ${url} answered ${pre.status} with Access-Control-Allow-Origin ${pre.headers.get("access-control-allow-origin") || "(none)"}`);
      }
      const methods = listHeader(pre.headers.get("access-control-allow-methods"));
      if (!SAFE_METHODS.has(method) && !methods.includes("*") && !methods.includes(method.toLowerCase())) {
        throw new TypeError(`CORS preflight refused: method ${method} not allowed by ${url}`);
      }
      const allowed = listHeader(pre.headers.get("access-control-allow-headers"));
      const missing = unsafe.filter((h) => !allowed.includes("*") && !allowed.includes(h));
      if (missing.length) {
        throw new TypeError(`CORS preflight refused: headers ${missing.join(", ")} not allowed by ${url}`);
      }
    }
    const res = await baseFetch(url, { ...init, headers: { ...headers, origin } });
    if (!originAllowed(res, origin)) {
      throw new TypeError(`CORS refused: ${method} ${url} answered ${res.status} without an Access-Control-Allow-Origin for ${origin}`);
    }
    const exposed = listHeader(res.headers.get("access-control-expose-headers"));
    const visible = new Headers();
    for (const [k, v] of res.headers.entries()) {
      if (SAFE_RESPONSE_HEADERS.has(k) || exposed.includes("*") || exposed.includes(k)) {
        visible.append(k, v);
      }
    }
    const body = NULL_BODY.has(res.status) ? null : await res.arrayBuffer();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: visible });
  };
}
