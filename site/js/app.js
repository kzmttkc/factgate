// FactGate page object. The page's own buttons and the assistant's website_* tools call the
// same methods, so there is one set of rules (the pure engine in gate.mjs).
import { DASH, verdictCard } from "./card.mjs";
import { withConsent } from "./consent.mjs";
import { TRY_THESE } from "./examples.mjs";
import { evaluateGate, gateRules } from "./gate.mjs";
import { fetchVet402Delivery } from "./gatecheck.mjs";
import { nandaLine } from "./nanda.mjs";
import { createSessionSigningKey, signAgentFactsWithSessionKey, verifyAgentFactsSignature } from "./agentfacts-sign.mjs";
import { gateCheckRead, inspectManifestRead, probeCapabilitiesRead, readIdentityRead } from "./reads.mjs";
import { DEFAULT_VALIDATORS, normalizeTrusted } from "./validators.mjs";

export { VET402_MCP } from "./gatecheck.mjs";

/**
 * Visibly retire the previous verdict card while a new check waits on consent.
 */
export function supersedeResultBox(box, doc = typeof document !== "undefined" ? document : null) {
  if (!box || box.hidden || !doc) {
    return false;
  }
  box.classList.add("result-superseded");
  box.dataset.superseded = "true";
  if (!box.querySelector(".result-superseded-note")) {
    const note = doc.createElement("p");
    note.className = "result-superseded-note";
    note.textContent = "Previous check — replaced when this one finishes.";
    if (typeof box.prepend === "function") {
      box.prepend(note);
    } else if (box.firstChild) {
      box.insertBefore(note, box.firstChild);
    } else {
      box.appendChild(note);
    }
  }
  return true;
}

const VALIDATORS_KEY = "factgate.trustedValidators.v1";

function pageFetch(url, init) {
  return globalThis.fetch(url, init);
}

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Holds the checks saved on this page and runs the verdict engine.
 */
class GatePage {
  constructor() {
    this.version = 0;
    // Saved checks, each from a measurement record that page code made.
    this.checks = [];
    this.nextId = 1;
    // Measurement records: what page code measured in this visit, by ID ("M-1"). The assistant
    // can judge or save a check only by one of these IDs, never from pillar values it wrote.
    this.measurements = new Map();
    this.nextMeasurement = 1;
    // Verdicts from pillar values typed into the Developer form: kept apart, never "measured".
    this.handEntered = [];
    this.nextHand = 1;
    this.lastResult = null;
    // Origins the visitor allowed "for this visit" on a consent card. Lost when the page closes.
    this.remembered = new Set();
    // Every consent card shown, with the answer, for the page and the tests.
    this.cards = [];
    // Who answers a consent card: the page's card in a browser, a test in Node. Without one,
    // nothing is contacted (fail closed).
    this.consentHandler = null;
    this.trustedValidators = GatePage.loadTrusted();
    this.signingKey = null;
  }

  async ensureSigningKey() {
    if (!this.signingKey) {
      this.signingKey = await createSessionSigningKey();
    }
    return this.signingKey;
  }

  async signAgentFacts(facts) {
    const key = await this.ensureSigningKey();
    facts.x_factgate_signature = await signAgentFactsWithSessionKey(facts, key);
    return facts;
  }

  /**
   * The visitor's trusted-validator list: their saved one, else the published default.
   */
  static loadTrusted() {
    try {
      const saved = storage()?.getItem(VALIDATORS_KEY);
      const list = saved ? normalizeTrusted(JSON.parse(saved)) : null;
      return list && list.length ? list : normalizeTrusted(DEFAULT_VALIDATORS);
    } catch {
      return normalizeTrusted(DEFAULT_VALIDATORS);
    }
  }

  /**
   * Replace the trusted-validator list (kept in this browser only). An empty list counts no
   * validation score at all.
   */
  setTrustedValidators(list) {
    this.trustedValidators = normalizeTrusted(list);
    try {
      storage()?.setItem(VALIDATORS_KEY, JSON.stringify(this.trustedValidators));
    } catch {
      // Private window: the list still holds for this page.
    }
    return { ok: true, trustedValidators: this.trustedValidators };
  }

  resetTrustedValidators() {
    try {
      storage()?.removeItem(VALIDATORS_KEY);
    } catch {
      // nothing saved
    }
    this.trustedValidators = normalizeTrusted(DEFAULT_VALIDATORS);
    return { ok: true, trustedValidators: this.trustedValidators };
  }

  /**
   * Ask the visitor before a check contacts new origins (js/consent.mjs calls this).
   *
   * :return: "once", "visit" or "decline".
   */
  async ask(request) {
    let answer = "decline";
    if (typeof this.consentHandler === "function") {
      answer = await this.consentHandler(request);
    } else if (typeof document !== "undefined") {
      const { askInPage } = await import("./consent-card.mjs");
      answer = await askInPage(request);
    }
    this.cards.push({ rows: request.rows.map((r) => ({ host: r.host, purposes: r.purposes })), answer });
    return answer;
  }

  consentOptions() {
    return { ask: this.ask.bind(this), remembered: this.remembered, trustedValidators: this.trustedValidators };
  }

  /**
   * Return a copy of the page state: the rules, the saved checks (measured) and, apart from them,
   * the hand-entered verdicts, with the version.
   */
  getState() {
    const copy = (c) => ({ ...c, reasons: c.reasons.map((r) => ({ ...r })) });
    return {
      version: this.version,
      ...gateRules(),
      checks: this.checks.map(copy),
      handEntered: this.handEntered.map(copy),
      measurements: [...this.measurements.values()].map((m) => ({ measurementId: m.id, kind: m.kind, url: m.url, checkedAt: m.checkedAt, verdict: m.verdict })),
    };
  }

  /**
   * Keep what page code measured, under a new ID.
   *
   * :param record: { kind, url, checkedAt, pillars, verdict }.
   * :return: The ID, such as "M-1".
   */
  recordMeasurement(record) {
    const id = `M-${this.nextMeasurement}`;
    this.nextMeasurement += 1;
    this.measurements.set(id, { id, ...record });
    return id;
  }

  measurement(id) {
    return typeof id === "string" ? this.measurements.get(id.trim()) || null : null;
  }

  static unknownMeasurement(id) {
    return { ok: false, reason: `No measurement ${String(id || "")} in this visit. Run website_gate_check (or website_check_seller) first and use the measurementId it returns.`, field: "measurementId" };
  }

  /**
   * Run the engine again on one measurement record. Changes nothing.
   *
   * :param args: { measurementId }.
   */
  evaluate(args) {
    const m = this.measurement(args && args.measurementId);
    if (!m) {
      return GatePage.unknownMeasurement(args && args.measurementId);
    }
    const result = evaluateGate(m.pillars);
    return { ok: true, measurementId: m.id, url: m.url, checkedAt: m.checkedAt, verdict: result.verdict, reasons: result.reasons };
  }

  /**
   * Save the verdict of one measurement record in the visible list. The visitor can remove it.
   *
   * :param args: { measurementId, label? }.
   */
  saveCheck(args) {
    const m = this.measurement(args && args.measurementId);
    if (!m) {
      return GatePage.unknownMeasurement(args && args.measurementId);
    }
    const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : m.url;
    const result = evaluateGate(m.pillars);
    const check = { id: `FG-${this.nextId}`, label, verdict: result.verdict, reasons: result.reasons, measurementId: m.id, checkedAt: m.checkedAt, source: "measured" };
    this.nextId += 1;
    this.checks.push(check);
    this.version += 1;
    GatePage.render(this);
    return { ok: true, check, version: this.version };
  }

  /**
   * The Developer form: judge pillar results typed by hand. Kept apart from measured checks and
   * marked "hand-entered, not measured". Not offered to the assistant.
   */
  saveHandEntered(args) {
    const label = typeof args?.label === "string" ? args.label.trim() : "";
    if (!label) {
      return { ok: false, reason: "Give a label, such as the counterparty's URL.", field: "label" };
    }
    const result = evaluateGate(args);
    const check = { id: `HAND-${this.nextHand}`, label, verdict: result.verdict, reasons: result.reasons, source: "hand-entered", note: "hand-entered, not measured" };
    this.nextHand += 1;
    this.handEntered.push(check);
    this.version += 1;
    GatePage.render(this);
    return { ok: true, check, version: this.version };
  }

  /**
   * Remove a saved check or a hand-entered verdict. Undoes saveCheck and saveHandEntered.
   */
  removeCheck(id) {
    const before = this.checks.length + this.handEntered.length;
    this.checks = this.checks.filter((c) => c.id !== id);
    this.handEntered = this.handEntered.filter((c) => c.id !== id);
    if (this.checks.length + this.handEntered.length === before) {
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
    const { result } = await withConsent((gated) => fetchVet402Delivery(gated, url), { fetch: pageFetch, ask: this.ask.bind(this), remembered: this.remembered });
    return result.pillar;
  }

  /**
   * The full check: live probe, declared ERC-8004 registration read on chain, vet402 record,
   * verdict and AgentFacts. Keeps the last result for the page's preview and download.
   */
  async gateCheck(args) {
    const r = await gateCheckRead(args || {}, pageFetch, this.consentOptions());
    if (r.ok === false) {
      return r;
    }
    this.lastResult = r.result;
    await this.signAgentFacts(this.lastResult.agentFacts);
    const measurementId = this.recordMeasurement({ kind: "gate_check", url: r.result.url, checkedAt: r.result.checkedAt, pillars: r.result.pillars, verdict: r.result.verdict });
    GatePage.renderResult(r.result);
    return { ...r.summary, measurementId };
  }

  inspectManifest(args) {
    return inspectManifestRead(args || {}, pageFetch, this.consentOptions());
  }

  probeCapabilities(args) {
    return probeCapabilitiesRead(args || {}, pageFetch, this.consentOptions());
  }

  readIdentity(args) {
    return readIdentityRead(args || {}, pageFetch, this.consentOptions());
  }

  /**
   * Show a full check: the verdict card (three pillars side by side, three counts), the values
   * read, the consent given, and the AgentFacts preview. Does nothing outside a browser.
   */
  static renderResult(result) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const box = document.querySelector("#full-result");
    if (!box) {
      return;
    }
    const card = verdictCard(result);
    box.hidden = false;
    box.classList.remove("result-superseded");
    delete box.dataset.superseded;
    const oldNote = box.querySelector(".result-superseded-note");
    if (oldNote) {
      oldNote.remove();
    }
    box.className = `result result-${card.verdict.toLowerCase()}`;
    // First line: what to do. The verdict word and the target follow.
    document.querySelector("#full-action").textContent = card.action;
    const verdict = document.querySelector("#full-verdict");
    verdict.textContent = card.verdict;
    verdict.className = `badge badge-${card.verdict.toLowerCase()}`;
    document.querySelector("#full-target").textContent = card.target;
    document.querySelector("#full-time").textContent = `checked ${card.checkedAt.replace("T", " ").slice(0, 19)} UTC`;
    const fill = (selector, items) => {
      const ul = document.querySelector(selector);
      ul.replaceChildren();
      for (const text of items) {
        const li = document.createElement("li");
        li.textContent = text;
        ul.append(li);
      }
    };
    fill("#full-not-measured", card.measured.notMeasured);
    document.querySelector("#full-not-measured-box").hidden = card.measured.notMeasured.length === 0;
    fill("#full-measured", [...card.measured.measured, ...card.measured.notApplicable.map((t) => `${t}: not applicable (asks for no payment; not a pass)`)]);
    for (const c of card.counts) {
      const el = document.querySelector(`#count-${c.key}`);
      // Keep "passed n" and "below 70 m" each on one line when the box is narrow.
      el.textContent = c.value.replace(/^passed (\S+) \/ below 70 (\S+)$/, "passed\u00a0$1\u00a0/ below\u00a070\u00a0$2");
      el.classList.toggle("is-empty", c.value === DASH);
      el.classList.toggle("is-pair", c.key === "validationsPassed" && c.value !== DASH);
    }
    const pillars = document.querySelector("#full-pillars");
    pillars.replaceChildren();
    for (const p of card.pillars) {
      const article = document.createElement("article");
      article.className = `pillar pillar-${p.effect.toLowerCase().replace("_", "-")}`;
      const hint = document.createElement("p");
      hint.className = "pillar-hint";
      hint.textContent = p.hint;
      const title = document.createElement("h3");
      title.textContent = p.title;
      const state = document.createElement("p");
      state.className = "pillar-state";
      state.textContent = p.label;
      const line = document.createElement("p");
      line.className = "pillar-line";
      line.textContent = p.line;
      article.append(hint, title, state, line);
      if (p.lastDelivered) {
        const fresh = document.createElement("p");
        fresh.className = "pillar-note";
        fresh.textContent = p.lastDelivered;
        article.append(fresh);
      }
      if (p.note) {
        const note = document.createElement("p");
        note.className = "pillar-note";
        note.textContent = p.note;
        article.append(note);
      }
      const more = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Details";
      const full = document.createElement("p");
      full.textContent = p.detail;
      const code = document.createElement("code");
      code.textContent = p.code;
      more.append(summary, full, code);
      article.append(more);
      pillars.append(article);
    }
    document.querySelector("#full-nanda").textContent = `${nandaLine(result.nanda)}${result.nanda && result.nanda.status === "listed" && result.nanda.record.identifier ? ` (${result.nanda.record.identifier})` : ""}. Shown, not used in the verdict.`;
    const unofficial = document.querySelector("#full-unofficial");
    const others = result.evidence.identity.unofficial || [];
    unofficial.hidden = others.length === 0;
    unofficial.textContent = others.length ? `Other registries (shown, not used in the verdict): ${others.map((u) => `agentId ${u.agentId} at ${u.agentRegistry}`).join("; ")}` : "";
    const http = document.querySelector("#full-http");
    http.replaceChildren();
    const rows = [...result.evidence.live.http, ...((result.evidence.identity.chainRead && result.evidence.identity.chainRead.rpc) || []).map((x) => ({ method: `${x.method} @${x.block}`, url: x.url, status: x.ok ? (x.reverted ? "reverted" : "200") : undefined, error: x.ok ? undefined : x.error }))];
    const val = result.evidence.delivery.validation;
    if (val && val.data) {
      rows.push({ method: `ValidationRegistry ${val.data.registry}`, url: `agent ${val.data.agentId}: ${val.data.total} requests, ${val.data.passed} >= 70, ${val.data.failed} < 70, ${val.data.pending} unanswered, ${val.data.untrusted || 0} from untrusted validators`, status: "eth_call" });
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
    const consent = document.querySelector("#full-consent");
    consent.replaceChildren();
    const given = result.consent;
    for (const o of given ? given.approved : []) {
      const li = document.createElement("li");
      li.textContent = `${new URL(o).host}: allowed`;
      consent.append(li);
    }
    for (const o of given ? given.declined : []) {
      const li = document.createElement("li");
      li.textContent = `${new URL(o).host}: declined, not contacted`;
      consent.append(li);
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
    const measurementId = this.recordMeasurement({ kind: "check_seller", url, checkedAt: new Date().toISOString(), pillars, verdict: result.verdict });
    return { ok: true, url, measurementId, verdict: result.verdict, reasons: result.reasons, delivery: delivery.status === "ok" ? GatePage.deliverySummary(delivery.data) : delivery };
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
   * Draw the saved checks (measured) and, in their own list, the hand-entered verdicts. Does
   * nothing outside a browser.
   */
  static render(page) {
    if (typeof window === "undefined") {
      return;
    }
    const draw = (selector, items, tag) => {
      const list = document.querySelector(selector);
      if (!list) {
        return;
      }
      list.replaceChildren();
      for (const c of items) {
        const li = document.createElement("li");
        li.className = `check-item verdict-${c.verdict.toLowerCase()}`;
        const head = document.createElement("strong");
        head.textContent = `${c.verdict} — ${c.label} (${c.id}${tag(c)})`;
        const reasons = document.createElement("ul");
        for (const r of c.reasons) {
          const item = document.createElement("li");
          item.textContent = `[${r.effect}] ${r.pillar}: ${r.short || r.text}`;
          reasons.append(item);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => page.removeCheck(c.id));
        li.append(head, reasons, remove);
        list.append(li);
      }
    };
    draw("#checks", page.checks, (c) => `, measured as ${c.measurementId}`);
    draw("#hand-checks", page.handEntered, () => ", hand-entered, not measured");
  }
}

export class App {
  static page = new GatePage();

  /**
   * Wire the page's own form to the same methods the assistant uses.
   */
  static wire() {
    App.wireFullCheck();
    App.wireTryThese();
    App.wireValidators();
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
      const saved = App.page.saveHandEntered({ label, ...pillars });
      out.textContent = saved.ok ? `Verdict: ${saved.check.verdict} (hand-entered, not measured)` : saved.reason;
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
      const typed = document.querySelector("#target-url").value.trim();
      const agentId = document.querySelector("#agent-id").value.trim();
      const chainId = Number(document.querySelector("#chain-id").value);
      // A URL is checked as is; anything else is a NANDA Index id, orgId or name to look up.
      const target = /^https?:\/\//i.test(typed) ? { url: typed } : { nanda: typed };
      status.textContent = "Waiting for your approval before anything is contacted…";
      supersedeResultBox(document.querySelector("#full-result"));
      document.querySelector("#run-check").disabled = true;
      try {
        const out = await App.page.gateCheck(agentId ? { ...target, agentId, chainId } : target);
        status.textContent = out.ok === false ? out.reason : `Done: ${out.action} (${out.verdict}).`;
      } finally {
        document.querySelector("#run-check").disabled = false;
      }
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
    const verifyBtn = document.querySelector("#verify-facts");
    const verifyStatus = document.querySelector("#verify-facts-status");
    if (verifyBtn && verifyStatus) {
      verifyBtn.addEventListener("click", async () => {
        const facts = App.page.lastResult && App.page.lastResult.agentFacts;
        if (!facts) {
          verifyStatus.hidden = false;
          verifyStatus.textContent = "Run a check first.";
          return;
        }
        const out = await verifyAgentFactsSignature(facts);
        verifyStatus.hidden = false;
        verifyStatus.textContent = out.valid
          ? "Signature OK: this JSON matches what FactGate signed after measurement in this session."
          : `Signature failed: ${out.reason || "mismatch"}.`;
      });
    }
  }

  /**
   * The "Try these" buttons: fill the URL and run the same check.
   */
  static wireTryThese() {
    const box = document.querySelector("#try-these");
    if (!box) {
      return;
    }
    for (const t of TRY_THESE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "try";
      b.dataset.url = t.url;
      const name = document.createElement("span");
      name.textContent = t.label;
      const note = document.createElement("small");
      note.textContent = t.note;
      b.append(name, note);
      b.addEventListener("click", () => {
        document.querySelector("#target-url").value = t.url;
        document.querySelector("#full-form").requestSubmit();
      });
      box.append(b);
    }
  }

  /**
   * The trusted-validator list: shown, editable, kept in this browser.
   */
  static wireValidators() {
    const list = document.querySelector("#validator-list");
    const form = document.querySelector("#validator-form");
    if (!list || !form) {
      return;
    }
    const draw = () => {
      list.replaceChildren();
      if (!App.page.trustedValidators.length) {
        const li = document.createElement("li");
        li.textContent = "No validator is trusted: no validation score counts.";
        list.append(li);
      }
      for (const v of App.page.trustedValidators) {
        const li = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = v.address;
        const text = document.createElement("span");
        text.textContent = ` ${v.name}${v.chains.length ? ` (chain ${v.chains.join(", ")})` : " (any chain)"} `;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "link";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          App.page.setTrustedValidators(App.page.trustedValidators.filter((x) => x !== v));
          draw();
        });
        li.append(code, text, remove);
        list.append(li);
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const address = document.querySelector("#validator-address").value.trim();
      const chain = Number(document.querySelector("#validator-chain").value);
      const next = [...App.page.trustedValidators, { address, chains: chain ? [chain] : [], name: "added by you" }];
      const cleaned = App.page.setTrustedValidators(next).trustedValidators;
      document.querySelector("#validator-out").textContent = cleaned.length === next.length ? "Added. It counts from the next check." : "That is not an 0x address with 40 hex digits.";
      draw();
    });
    document.querySelector("#validator-reset").addEventListener("click", () => {
      App.page.resetTrustedValidators();
      document.querySelector("#validator-out").textContent = "Back to the published list (validators.json).";
      draw();
    });
    draw();
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
