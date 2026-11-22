// The consent card a FactGate check shows before it contacts an origin (js/consent.mjs).
// It lists each destination origin with what would be sent there. Each row has its own
// Allow / Decline choice, so the visitor can, for example, allow the counterparty and decline the
// NANDA Index. Then "Allow selected once", "Allow selected for this visit" (remembered per origin
// until the page closes) or "Decline all". Nothing is contacted while it waits. Browser only.

/**
 * Show the card and wait for the visitor.
 *
 * :param request: { rows: [{ origin, host, purposes[] }], round }, from withConsent().
 * :param options: { title?, intro?, doc? }
 * :return: A promise of "decline" (all rows) or { decisions: { [origin]: "once" | "visit" | "decline" } }.
 */
export function askInPage(request, options = {}) {
  const doc = options.doc || document;
  return new Promise((resolve) => {
    doc.querySelector(".fg-consent")?.remove();
    const card = doc.createElement("section");
    card.className = "fg-consent";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-labelledby", "fg-consent-title");
    const title = doc.createElement("h2");
    title.id = "fg-consent-title";
    title.tabIndex = -1;
    title.textContent = options.title || (request.round > 1 ? "FactGate needs to contact more sites for this check" : "FactGate needs to contact this site for the check");
    const intro = doc.createElement("p");
    intro.textContent = options.intro || "Nothing has been sent yet. Each origin below gets only what is listed. Choose for each one. FactGate never pays, signs or sends a key.";
    const list = doc.createElement("ul");
    list.className = "fg-consent-rows";
    const choices = new Map();
    request.rows.forEach((row, i) => {
      const item = doc.createElement("li");
      const text = doc.createElement("div");
      text.className = "fg-consent-text";
      const host = doc.createElement("code");
      host.textContent = row.host;
      const why = doc.createElement("span");
      why.textContent = row.purposes.join("; ");
      text.append(host, why);
      const group = doc.createElement("fieldset");
      group.className = "fg-consent-choice";
      const legend = doc.createElement("legend");
      legend.className = "visually-hidden";
      legend.textContent = `Contact ${row.host}?`;
      group.append(legend);
      for (const [value, words] of [["allow", "Allow"], ["decline", "Decline"]]) {
        const label = doc.createElement("label");
        const input = doc.createElement("input");
        input.type = "radio";
        input.name = `fg-consent-${request.round}-${i}`;
        input.value = value;
        input.checked = value === "allow";
        label.append(input, doc.createTextNode(` ${words}`));
        group.append(label);
      }
      choices.set(row.origin, group);
      item.append(text, group);
      list.append(item);
    });
    const actions = doc.createElement("div");
    actions.className = "fg-consent-actions";
    const finish = (answer) => {
      card.remove();
      resolve(answer);
    };
    const selected = (how) => {
      const decisions = {};
      for (const [origin, group] of choices) {
        const pick = group.querySelector("input:checked");
        decisions[origin] = pick && pick.value === "allow" ? how : "decline";
      }
      return { decisions };
    };
    const once = doc.createElement("button");
    once.type = "button";
    once.textContent = "Allow selected once";
    once.addEventListener("click", () => finish(selected("once")));
    const visit = doc.createElement("button");
    visit.type = "button";
    visit.className = "secondary";
    visit.textContent = "Allow selected for this visit";
    visit.addEventListener("click", () => finish(selected("visit")));
    const decline = doc.createElement("button");
    decline.type = "button";
    decline.className = "secondary";
    decline.textContent = "Decline all";
    decline.addEventListener("click", () => finish("decline"));
    actions.append(once, visit, decline);
    card.append(title, intro, list, actions);
    doc.body.append(card);
    title.focus();
  });
}
