// The consent card a FactGate check shows before it contacts an origin (js/consent.mjs).
// It lists each destination origin with what would be sent there, and offers three answers:
// "Allow once", "Allow for this visit" (remembered per origin until the page closes) and
// "Decline". Nothing is contacted while it waits. Browser only.

/**
 * Show the card and wait for the visitor.
 *
 * :param request: { rows: [{ origin, host, purposes[] }], round }, from withConsent().
 * :param options: { title?, intro?, doc? }
 * :return: A promise of "once", "visit" or "decline".
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
    intro.textContent = options.intro || "Nothing has been sent yet. Each origin below gets only what is listed. FactGate never pays, signs or sends a key.";
    const list = doc.createElement("ul");
    list.className = "fg-consent-rows";
    for (const row of request.rows) {
      const item = doc.createElement("li");
      const host = doc.createElement("code");
      host.textContent = row.host;
      const why = doc.createElement("span");
      why.textContent = row.purposes.join("; ");
      item.append(host, why);
      list.append(item);
    }
    const actions = doc.createElement("div");
    actions.className = "fg-consent-actions";
    const finish = (answer) => {
      card.remove();
      resolve(answer);
    };
    const once = doc.createElement("button");
    once.type = "button";
    once.textContent = "Allow once";
    once.addEventListener("click", () => finish("once"));
    const visit = doc.createElement("button");
    visit.type = "button";
    visit.className = "secondary";
    visit.textContent = "Allow for this visit";
    visit.addEventListener("click", () => finish("visit"));
    const decline = doc.createElement("button");
    decline.type = "button";
    decline.className = "secondary";
    decline.textContent = "Decline";
    decline.addEventListener("click", () => finish("decline"));
    actions.append(once, visit, decline);
    card.append(title, intro, list, actions);
    doc.body.append(card);
    title.focus();
  });
}
