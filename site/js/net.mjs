// Small network helpers shared by the probes. The fetch function is always passed in, so the
// same code runs in the browser (window.fetch, where the browser enforces CORS) and in Node
// (scripts/cors-fetch.mjs, which applies the same CORS rules to what the server sent).

export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * fetch with a timeout and without credentials. Never throws: returns
 * { ok: true, response } or { ok: false, error } (a CORS refusal, a DNS failure and a timeout
 * all look like a TypeError to a browser page, and all mean "the browser cannot reach it").
 */
export async function timedFetch(fetchImpl, url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, { credentials: "omit", redirect: "follow", ...init, signal: controller ? controller.signal : undefined });
    if (!response || typeof response.status !== "number") {
      return { ok: false, error: "no response" };
    }
    return { ok: true, response };
  } catch (error) {
    const name = error && error.name === "AbortError" ? "timeout" : String(error && error.message ? `${error.name || "Error"}: ${error.message}` : error);
    return { ok: false, error: name };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Read a body as text, capped, never throwing. */
export async function readText(response, maxBytes = 512 * 1024) {
  try {
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return "";
  }
}

/** Parse JSON or return null. */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Same origin, compared as URL origins. False when either is not a URL. */
export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
