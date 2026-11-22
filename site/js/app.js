// FactGate page object. The page's own buttons and the assistant's website_* tools call the
// same methods, so there is one set of rules (the pure engine in gate.mjs).
import { evaluateGate, gateRules } from "./gate.mjs";
import { fetchVet402Delivery } from "./gatecheck.mjs";
import { gateCheckRead, inspectManifestRead, probeCapabilitiesRead, readIdentityRead } from "./reads.mjs";

export { VET402_MCP } from "./gatecheck.mjs";

function pageFetch(url, init) {
  return globalThis.fetch(url, init);
}

/**
 * Holds the checks saved on this page and runs the verdict engine.
 */
class GatePage {
  constructor() {
    this.version = 0;
    this.checks = [];
    this.nextId = 1;
    this.lastResult = null;
  }

  /**
   * Return a copy of the page state: the rules, the saved checks and the version.
   */
  getState() {
    return {
      version: this.version,
      ...gateRules(),
      checks: this.checks.map((c) => ({ ...c, reasons: c.reasons.map((r) => ({ ...r })) })),
    };
  }

  /**
   * Run the engine on the three pillar results. Changes nothing.
   */
  evaluate(pillars) {
    if (!pillars || typeof pillars !== "object") {
      return { ok: false, reason: "Give the three pillar results as live, identity and delivery." };
    }
    const result = evaluateGate(pillars);
    return { ok: true, verdict: result.verdict, reasons: result.reasons };
  }

  /**
   * Evaluate and add the result to the visible list. The visitor can remove it on the page.
   */
  saveCheck(args) {
    const label = typeof args?.label === "string" ? args.label.trim() : "";
    if (!label) {
      return { ok: false, reason: "Give a label, such as the counterparty's URL.", field: "label" };
    }
    const result = evaluateGate(args);
    const check = { id: `FG-${this.nextId}`, label, verdict: result.verdict, reasons: result.reasons };
    this.nextId += 1;
    this.checks.push(check);
    this.version += 1;
    GatePage.render(this);
    return { ok: true, check, version: this.version };
  }

  /**
   * Remove a saved check. Undoes saveCheck.
   */
  removeCheck(id) {
    const before = this.checks.length;
    this.checks = this.checks.filter((c) => c.id !== id);
    if (this.checks.length === before) {
      return { ok: false, reason: `No saved check ${id}.`, field: "id" };
    }
    this.version += 1;
    GatePage.render(this);
    return { ok: true, version: this.version };
  }

  /**
   * Ask vet402.com/mcp for its delivery record of one x402 URL, straight from the browser.
   * Returns pillar 3. A failed call is "unavailable".
   */
  async fetchDelivery(url) {
    return (await fetchVet402Delivery(pageFetch, url)).pillar;
  }

  /**
   * The full check: live probe, declared ERC-8004 registration read on chain, vet402 record,
   * verdict and AgentFacts. Keeps the last result for the page's preview and download.
   */
  async gateCheck(args) {
    const r = await gateCheckRead(args || {}, pageFetch);
    if (r.ok === false) {
      return r;
    }
    this.lastResult = r.result;
    GatePage.renderResult(r.result);
    return r.summary;
  }

  inspectManifest(args) {
    return inspectManifestRead(args || {}, pageFetch);
  }

  probeCapabilities(args) {
    return probeCapabilitiesRead(args || {}, pageFetch);
  }

  readIdentity(args) {
    return readIdentityRead(args || {}, pageFetch);
  }

  /**
   * Show a full check: verdict, reasons, the values read, and the AgentFacts preview.
   * Does nothing outside a browser.
   */
  static renderResult(result) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const box = document.querySelector("#full-result");
    if (!box) {
      return;
    }
    box.hidden = false;
    const verdict = document.querySelector("#full-verdict");
    verdict.textContent = result.verdict;
    verdict.className = `verdict verdict-${result.verdict.toLowerCase()}`;
    const reasons = document.querySelector("#full-reasons");
    reasons.replaceChildren();
    for (const r of result.reasons) {
      const li = document.createElement("li");
      li.textContent = `[${r.effect === "NOT_APPLICABLE" ? "NOT APPLICABLE" : r.effect}] ${r.pillar}: ${r.text}`;
      reasons.append(li);
    }
    const unofficial = document.querySelector("#full-unofficial");
    const others = result.evidence.identity.unofficial || [];
    unofficial.hidden = others.length === 0;
    unofficial.textContent = others.length ? `Other registries (shown, not used in the verdict): ${others.map((u) => `agentId ${u.agentId} at ${u.agentRegistry}`).join("; ")}` : "";
    const http = document.querySelector("#full-http");
    http.replaceChildren();
    const rows = [...result.evidence.live.http, ...((result.evidence.identity.chainRead && result.evidence.identity.chainRead.rpc) || []).map((x) => ({ method: `${x.method} @${x.block}`, url: x.url, status: x.ok ? (x.reverted ? "reverted" : "200") : undefined, error: x.ok ? undefined : x.error }))];
    const val = result.evidence.delivery.validation;
    if (val && val.data) {
      rows.push({ method: `ValidationRegistry ${val.data.registry}`, url: `agent ${val.data.agentId}: ${val.data.total} requests, ${val.data.passed} >= 70, ${val.data.failed} < 70, ${val.data.pending} unanswered`, status: "eth_call" });
      for (const e of val.data.evidence || []) {
        rows.push({ method: e.role, url: e.log && e.log.tx ? `tx ${e.log.tx} (block ${e.log.block}, log ${e.log.logIndex})` : `request ${e.requestHash}`, status: `score ${e.response}` });
      }
    }
    if (result.evidence.delivery.http) {
      rows.push(result.evidence.delivery.http);
    }
    for (const h of rows) {
      const tr = document.createElement("tr");
      for (const v of [h.method, h.url, h.status ?? h.error ?? ""]) {
        const td = document.createElement("td");
        td.textContent = String(v);
        tr.append(td);
      }
      http.append(tr);
    }
    document.querySelector("#agentfacts").textContent = JSON.stringify(result.agentFacts, null, 2);
  }

  /** The last AgentFacts as a downloadable file name and text, or null. */
  agentFactsFile() {
    if (!this.lastResult) {
      return null;
    }
    let host = "counterparty";
    try {
      host = new URL(this.lastResult.url).host.replace(/[^A-Za-z0-9.-]/g, "_");
    } catch {
      // keep the default
    }
    return { name: `agentfacts_${host}.json`, text: `${JSON.stringify(this.lastResult.agentFacts, null, 2)}\n` };
  }

  /**
   * Check one x402 URL's delivery pillar only (vet402's record), read by this code. Live and
   * identity are left unavailable here; gateCheck measures all three.
   */
  async checkSeller(url) {
    if (typeof url !== "string" || !/^https:\/\//.test(url)) {
      return { ok: false, reason: "Give an absolute https x402 URL.", field: "url" };
    }
    const delivery = await this.fetchDelivery(url);
    const pillars = {
      live: { status: "unavailable", error: "not measured by check_seller; use gate_check for all three pillars" },
      identity: { status: "unavailable", error: "not measured by check_seller; use gate_check for all three pillars" },
      delivery,
    };
    const result = evaluateGate(pillars);
    return { ok: true, url, verdict: result.verdict, reasons: result.reasons, delivery: delivery.status === "ok" ? GatePage.deliverySummary(delivery.data) : delivery };
  }

  /**
   * The few vet402 fields worth showing, with the record link.
   */
  static deliverySummary(d) {
    return {
      recommendation: d.recommendation,
      reason_codes: d.reason_codes,
      delivery: d.delivery,
      not_in_catalog: d.not_in_catalog,
      verified_terms: d.verified_terms,
      record_url: d.record_url,
      as_of: d.as_of,
    };
  }

  /**
   * Draw the saved checks. Does nothing outside a browser.
   */
  static render(page) {
    if (typeof window === "undefined") {
      return;
    }
    const list = document.querySelector("#checks");
    if (!list) {
      return;
    }
    list.replaceChildren();
    for (const c of page.checks) {
      const li = document.createElement("li");
      li.className = `check verdict-${c.verdict.toLowerCase()}`;
      const head = document.createElement("strong");
      head.textContent = `${c.verdict} — ${c.label} (${c.id})`;
      const reasons = document.createElement("ul");
      for (const r of c.reasons) {
        const item = document.createElement("li");
        item.textContent = `[${r.effect}] ${r.pillar}: ${r.text}`;
        reasons.append(item);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => page.removeCheck(c.id));
      li.append(head, reasons, remove);
      list.append(li);
    }
  }
}

export class App {
  static page = new GatePage();

  /**
   * Wire the page's own form to the same methods the assistant uses.
   */
  static wire() {
    App.wireFullCheck();
    const form = document.querySelector("#gate-form");
    const out = document.querySelector("#gate-out");
    const fetchButton = document.querySelector("#fetch-delivery");
    fetchButton.addEventListener("click", async () => {
      const url = document.querySelector("#seller-url").value.trim();
      out.textContent = "Asking vet402.com/mcp from this browser…";
      const pillar = await App.page.fetchDelivery(url);
      const input = document.querySelector("#pillars");
      const current = App.safeParse(input.value) || {};
      current.delivery = pillar;
      input.value = JSON.stringify(current, null, 2);
      out.textContent = `delivery pillar: ${pillar.status}${pillar.error ? ` (${pillar.error})` : ""}`;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const pillars = App.safeParse(document.querySelector("#pillars").value);
      if (!pillars) {
        out.textContent = "The pillar JSON does not parse.";
        return;
      }
      const label = document.querySelector("#seller-url").value.trim() || "unnamed counterparty";
      const saved = App.page.saveCheck({ label, ...pillars });
      out.textContent = saved.ok ? `Verdict: ${saved.check.verdict}` : saved.reason;
    });
  }

  /**
   * The full-check form: the same gateCheck the assistant's website_gate_check calls.
   */
  static wireFullCheck() {
    const form = document.querySelector("#full-form");
    if (!form) {
      return;
    }
    const status = document.querySelector("#full-status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = document.querySelector("#target-url").value.trim();
      const agentId = document.querySelector("#agent-id").value.trim();
      const chainId = Number(document.querySelector("#chain-id").value);
      status.textContent = "Checking from this browser: manifest, MCP, x402 terms, ERC-8004 on chain, vet402…";
      const out = await App.page.gateCheck(agentId ? { url, agentId, chainId } : { url });
      status.textContent = out.ok === false ? out.reason : `Done: ${out.verdict}`;
    });
    document.querySelector("#download-facts").addEventListener("click", () => {
      const file = App.page.agentFactsFile();
      if (!file) {
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  static safeParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

if (typeof window !== "undefined") {
  App.wire();
}
