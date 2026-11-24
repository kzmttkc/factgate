# FactGate: checks a stranger before your agent pays it

My agent was about to book the nicer hotel. I had built that hotel to fail. FactGate caught it.

Agent Customs scans prompts. Agent Atlas checks the format. FactGate decides before a partner network loads, from measured live answers, on-chain identity and delivery.

Cognizant's [2026-11-19 blog](https://www.cognizant.com/us/en/ai-lab/blog/ai-agent-negotiation-open-agentic-web) says a working agent economy needs a way to establish trust between parties with no prior relationship. FactGate is that check before Stay Steward loads a hotel network: live answers, the ERC-8004 wallet against the x402 payee, and delivery after payment.

Before your agent links to or pays a site, FactGate checks three facts:
**Live** (does it answer as declared?) · **Identity** (does the ERC-8004 wallet match the x402 payee?) · **Delivery** (did paid calls really return content?).
Code decides **ALLOW / CAUTION / BLOCK**. The model only explains.

**Built new for this challenge:** first commit 2026-11-22. vet402 and the Delivery Court validator are the author's earlier services, read here as external read-only sources.

![Architecture](docs/architecture.png)

▶ Try it: https://factgate.vercel.app/ (no key needed).  ▶ 2-min video: https://youtu.be/-feULvADy_o

| Verified Stay | Glossy Stay | agent402.tools (real x402 seller) |
|---|---|---|
| ALLOW → booked VS-0001 ([Stay Steward](https://stay-steward-demo.vercel.app/)) | BLOCK → never loaded | ALLOW (every paid call delivered, vet402 record, checked 2026-11-22) |

On 2026-11-23, 17 sites from the public list measured CAUTION. None measured ALLOW or BLOCK (`node scripts/ecosystem-snapshot.mjs`).

### Measured on 2026-11-23 (third-party ERC-8004, pillars 1 and 2 without vet402)

On 2026-11-23 FactGate measured **https://agent402.tools/api/weather-forecast** (a public x402 seller, not the author's demo sites): pillar 1 **ALLOW** (`live_as_declared`), pillar 2 **ALLOW** (`identity_match`, ERC-8004 agent 94639 on Base via `eth_call`). Overall **CAUTION** only because pillar 3 was not read (`node scripts/measure-pillars-12.mjs https://agent402.tools/api/weather-forecast`).

### Measured on 2026-11-22

On 2026-11-22 the deployed page measured agent402.tools as **ALLOW** because it answered as declared, `payTo` matched ERC-8004 agent 94639 on Base, and **vet402**, the author's own service, recorded every paid call delivered. The card shows the last delivery date. **Glossy Stay** is a fictional demo and was **BLOCK**, so Stay Steward refused to load it. The same day a local run (`evidence/live/SUMMARY.json`) measured five contest-listed sites as **CAUTION** (identity unknown). Unchecked here means the measurement did not finish.

The result that still runs on the live sites through judging is **Verified Stay booked (VS-0001)** and **Glossy Stay not loaded**. The paid seller is **https://agent402.tools/api/weather-forecast**. On 2026-11-22 **vet402**, the author's own service, recorded every paid call delivered (last delivered 2026-11-07, 30-day window). The card shows Last delivered: 2026-11-07 (vet402 window: 30 days). vet402 is scheduled to buy that URL once on 2027-01-10 UTC (see GRADER_FACTS.md). On 2026-11-22 the vet402 record for that URL was ALLOW (tier aging, stale after 30 days, evidence/live/agent402_tools_api_weather_forecast.json). The purchase window ends before judging opens, so the 30-day window covers judging. Delivery counts come only from the author's **vet402** and the author's recomputable validator.

**Screenshots** (deployed sites, captured 2026-11-22):

| What | 1440 px | 390 px |
| --- | --- | --- |
| FactGate ALLOW: agent402.tools (first line: Link / pay: OK) | [screenshots/allow-agent402-1440.png](screenshots/allow-agent402-1440.png) | [screenshots/allow-agent402-390.png](screenshots/allow-agent402-390.png) |
| FactGate BLOCK: Glossy Stay demo (first line: Do not pay) | [screenshots/block-glossy-stay-1440.png](screenshots/block-glossy-stay-1440.png) | [screenshots/block-glossy-stay-390.png](screenshots/block-glossy-stay-390.png) |
| Consent card: two destinations on separate rows | [screenshots/consent-two-destinations-1440.png](screenshots/consent-two-destinations-1440.png) | [screenshots/consent-two-destinations-390.png](screenshots/consent-two-destinations-390.png) |
| Stay Steward: Verified Stay booked (VS-0001) after FactGate ALLOW | [factgate-peers/screenshots/steward-booked-vs0001-1440.png](https://github.com/kzmttkc/factgate-peers/blob/main/screenshots/steward-booked-vs0001-1440.png) | [factgate-peers/screenshots/steward-booked-vs0001-390.png](https://github.com/kzmttkc/factgate-peers/blob/main/screenshots/steward-booked-vs0001-390.png) |
| Stay Steward: stopped on Glossy Stay BLOCK (reasons shown) | [factgate-peers/screenshots/steward-stopped-glossy-block-1440.png](https://github.com/kzmttkc/factgate-peers/blob/main/screenshots/steward-stopped-glossy-block-1440.png) | [factgate-peers/screenshots/steward-stopped-glossy-block-390.png](https://github.com/kzmttkc/factgate-peers/blob/main/screenshots/steward-stopped-glossy-block-390.png) |
| FactGate CAUTION: Stay Steward demo (first line: Unchecked — do not treat as safe) | [screenshots/caution-stay-steward-1440.png](screenshots/caution-stay-steward-1440.png) | [screenshots/caution-stay-steward-390.png](screenshots/caution-stay-steward-390.png) |

**Agents:** `gate_coordinator` turns a visitor request into a check and an explanation · `manifest_inspector` reads the counterparty manifest and NANDA listing · `capability_prober` probes live answers and MCP tools · `evidence_verifier` reads ERC-8004 on chain and vet402's delivery record.

**Check a counterparty before your agent links to it or pays it.**

For a site with no ERC-8004 registration, FactGate still tells you before you connect whether it answers the way it declares, whether its agent instructions are safe to load, and whether it can be reached at all.

FactGate is an open agentic website (Worldwide Agentic Web MVP spec) that answers one question for an agent builder or a visitor: *should my agent connect to this agent site, NANDA-listed agent or x402 seller?* It measures three things from the browser and returns a deterministic **ALLOW / CAUTION / BLOCK** with the evidence, plus an AgentFacts JSON.

| Pillar | What FactGate measures | Source |
| --- | --- | --- |
| 1. Answers as declared | The manifest (spec 3.3), the network definition, every declared MCP server (`initialize` → `tools/list`), the x402 terms (read, never paid), the declared paid resource, and a static scan of the instructions a caller would load (spec section 5, "Untrusted instructions") | The counterparty, over CORS |
| 2. Identity on chain | The ERC-8004 registration the site declares, read with `eth_call` and pinned to one block; its owner and agentWallet compared with the 402 `payTo`. A free site passes when the site and its registration point at each other | Base, Base Sepolia, Celo |
| 3. Delivered after payment | vet402's production record of paid calls that came back with content, and ERC-8004 ValidationRegistry scores from **trusted** validators only | vet402.com/mcp, ValidationRegistry |

The verdict is code (`site/js/gate.mjs`): the worst pillar wins, a pillar that could not be read is CAUTION (never zero, never good), and the language model only explains.

**CAUTION means "unchecked", not "a little risky":** something could not be measured, and the card lists exactly what (who it is, whether it answers, whether paid calls came back) next to what was measured, so a CAUTION is never treated as safe.

**Only validators in `site/validators.json` are counted, and today that list holds one: the Delivery Court judge, which is the author's own validator** (its scores can be recomputed from public records; others' scores are shown, never counted). Nothing is paid or signed, and **nothing is contacted before the visitor approves a card that lists each destination origin and what it gets** (spec 3.2 Consent, section 5).

**How FactGate breaks self-declaration:** a site's own manifest, AgentFacts and signature only say who wrote the claims, so FactGate compares every claim with what its endpoints actually answer, what the chain says its registered wallet is, and what **vet402**, the author's own service, recorded when someone paid it. It does not trust numbers the site printed about itself.

## Try it (deployed)

| Site | URL | Source |
| --- | --- | --- |
| FactGate | https://factgate.vercel.app/ (network name `https://factgate.vercel.app/factgate`, file `https://factgate.vercel.app/factgate.network.json`; a bare GET on `/factgate` may 404 while Stay Steward still loads the network after consent, see `site/factgate-gate.mjs`) | https://github.com/kzmttkc/factgate |
| Stay Steward (demo booking agent) | https://stay-steward-demo.vercel.app/ | https://github.com/kzmttkc/factgate-peers |
| Verified Stay (demo, expected ALLOW) | https://verified-stay-demo.vercel.app/ (`/verified_stay`) | same |
| Glossy Stay (demo, expected BLOCK) | https://glossy-stay-demo.vercel.app/ (network file `https://glossy-stay-demo.vercel.app/glossy_stay.network.json`) | same |

On Stay Steward, pick a stay and press **Check with FactGate**. No AI key is needed: page code runs the gate. Before Check with FactGate, allow pop-ups for stay-steward-demo.vercel.app. FactGate and each stay open in separate windows. Allow the cards and the windows it opens. Verified Stay ends with a booking made in Verified Stay's own window. Glossy Stay stops at FactGate's BLOCK, and the page shows why. The demo stays are fictional, and no money moves.

The four sites are static (Vercel), each on its own origin. `deploy/build-public.mjs` writes `dist/<project>/` with the local demo URLs rewritten to the public ones (`deploy/public-origins.json`) and a `vercel.json` with the CORS and worker headers; then `vercel deploy --prod dist/<project>`. The source keeps the local URLs, so the local run below is unchanged.

## Who it is for

- **Agent sites that link to other agent sites.** Before your network loads a partner network (spec 3.2), ask FactGate. The demo booking agent, Stay Steward, does exactly that: it never loads a stay that FactGate blocks, and its gate is page code, not a prompt.
- **Agents that pay x402 sellers.** Check the seller's payee against its on-chain identity and its delivery record before the first payment.
- **People reviewing an agent site.** Paste a URL, get the three pillars, the request log and a downloadable AgentFacts file.

## Compared with the tools already listed

**ScopeGate Studio** guards outbound calls as they leave the agent. **Agent Atlas** checks manifest format. **NandaSeal** records self-signed facts in the browser. **Agent Customs** runs a static prompt-injection scan. **Agent Crash Test** exercises confirm dialogs on your own site. **Three Numbers** reads XRPL escrow counts. **FactGate** checks live answers against declarations, on-chain identity against the x402 payee, and delivery after payment, then returns ALLOW / CAUTION / BLOCK before a partner site links or pays (used by Stay Steward's page-code gate).

## Try it

Open the page, press one of **Try these** (agent402.tools, Verified Stay, Glossy Stay) or paste a URL, or a NANDA Index id or name (for example `Heron A2A Checker`), approve the cards row by row, and read the verdict card. Its first line is what to do: **Link / pay: OK**, **Do not pay** (a paid counterparty FactGate blocked), **Do not link** (a free one it blocked) or **Unchecked — do not treat as safe** (CAUTION). Below it: what was measured and what was not. Three counts show paid calls and calls that came back with content in vet402's record, and trusted validations as "passed n / below 70 m" ("—" when not measured). Three pillars sit side by side, each with one short sentence (the full reason under Details). Pillar 3 may show when vet402 last saw content come back, and says that vet402 is the author's own service. The NANDA Index record appears if the counterparty is listed ("NANDA: listed, card not validated" when NANDA has not validated its card). Under the fold: the full request log, the approved origins and the AgentFacts.

Verdicts measured on 2026-11-22 06:57 UTC (`node scripts/probe-live.mjs --peers`, `evidence/live/SUMMARY.json`). The first word on the card is in brackets:

| Counterparty | Verdict | Why |
| --- | --- | --- |
| agent402.tools/api/weather-forecast (real x402 seller) | ALLOW (every paid call delivered, vet402 record, checked 2026-11-22) (Link / pay: OK) | Answers as declared; payTo = ERC-8004 agent 94639's owner and agentWallet on Base; every paid call delivered (vet402 record; the card shows the last delivery date) |
| vet402.com (the author's own service) | ALLOW (Link / pay: OK) | No payment asked; the site and its ERC-8004 registration point at each other (rule C-1) |
| Verified Stay (fictional demo, local) | ALLOW (Link / pay: OK) | payTo = agent 10798's wallet on Base Sepolia; trusted validations passed 79 / below 70 0 (the Delivery Court judge) |
| Glossy Stay (fictional demo, local) | BLOCK (Do not pay) | payTo is not its own declared wallet nor agent 10799's; the paid resource answers an empty body; trusted validations passed 1 / below 70 1 (a score of 3) |
| Stay Steward (fictional demo, local) | CAUTION: identity_unknown | Answers as declared; declares no ERC-8004 registration |
| Five agentic websites from the contest's list | CAUTION: identity_unknown | Answer as declared; none declares an ERC-8004 registration, so identity is not measured |
| The contest organizer's widget | CAUTION: unreachable, identity_unknown, no_delivery_record | Its manifest answers without `Access-Control-Allow-Origin`, so a browser cannot read it |

None of these is in the NANDA Index (when checked on 2026-11-22: 102 of 138 had no card validation, via `api.nandaindex.org/api/v1/index`, limit 200, offset paging). A listed example: `Heron A2A Checker` (`urn:air:heron.ing:catalog:root`) names a public index entry only. It shows "NANDA: listed, card not validated" on the card. Its own site did not answer the browser, so it is CAUTION (unreachable, identity_unknown, no_delivery_record). CAUTION here means the browser could not complete checks, not that the operator committed fraud.

## Run it

```shell
SKILL=../agentic-web/skills/agentify-website   # or set AGENTIFY_SKILL
cd factgate                                    # your clone of github.com/kzmttkc/factgate

# Build the network from the .hocon (after any change to it or the manifest)
node $SKILL/scripts/build_network.mjs site/factgate.hocon --manifest site/agent-manifest.json --check

# Tests (no LLM, no network)
node --test "test/*.test.mjs" "site/tests/*.test.mjs"

# Serve the page with the CORS headers other sites need
node $SKILL/scripts/serve_site.mjs site --port 8790 --open-as localhost     # http://localhost:8790/

# Measure real counterparties with the page's own code (writes evidence/live/)
node scripts/probe-live.mjs            # agent402, the contest's list, vet402.com
node scripts/probe-live.mjs --peers    # plus the three demo sites (serve them first, see below)
node scripts/probe-live.mjs --public   # as the deployed page: agent402 and the three deployed demo sites (writes evidence/public/)

# Ecosystem snapshot (contest list, aggregate counts only — writes evidence/ecosystem/SUMMARY.json)
node scripts/ecosystem-snapshot.mjs
```

**Ecosystem snapshot 2026-11-23:** 17 sites probed from the public list. 16 answered as declared, 16 manifests CORS-readable, 0 declare ERC-8004 in a readable registration file, 15 instruction scans clean. Verdicts ALLOW 0 / CAUTION 17 / BLOCK 0 (`node scripts/ecosystem-snapshot.mjs`).

### Run the three-site demo

The demo sites live in sibling `factgate-peers` (README there). Serve all four on different host names, so a key saved on one page is never sent to another (runtime/byok.js mirrors keys to a cookie per host name):

```shell
cd ../factgate-peers
node serve.mjs glossy-stay --port 8791                  # http://127.0.0.1:8791/
node serve.mjs verified-stay --port 8792                # http://127.0.0.1:8792/
node serve.mjs stay-steward --host ::1 --port 8793      # http://[::1]:8793/
```

Open Stay Steward, pick a stay, and press **Check with FactGate** (no AI key needed: page code runs the gate), or ask the assistant to book it. Stay Steward asks FactGate first (a card), FactGate's window asks before each origin it reads, and only then is the stay's network loaded (another card) and the booking made in the stay's own window. With Glossy Stay the gate stops at FactGate's BLOCK and shows why.

### Check with a real model

The tests use a scripted model. To check the same flows with a real LLM, use your own key; FactGate never stores one:

1. Serve the four sites as above and open `http://[::1]:8793/`.
2. In "AI model settings", choose the router (the default is Otari, `https://api.otari.ai/api/v1`), enter a model it serves and your key, then "Save and start".
3. Ask "Book my trip at the stay I picked." with Verified Stay, then with Glossy Stay.
4. Check: the FactGate card appears before any request to `localhost:8790` (browser Network panel); FactGate's window lists `127.0.0.1:879x` and then `sepolia.base.org` before contacting them; the gate log shows `FactGate checked ... ALLOW` or the BLOCK reasons; no request to a site carries an `Authorization` header (serve with `--log <file>` to see it per request).
5. On FactGate's own page, ask "Should my agent pay https://agent402.tools/api/weather-forecast?" and check the runtime's cards for vet402.com/mcp (discovery, then the call).

## Spec section 6 (stage 1, pass/fail)

| # | Check | Shown by |
| --- | --- | --- |
| 1 | Two-agent HOCON network and manifest on an ordinary host | `site/factgate.hocon` (four agents) → `site/factgate.network.json`, `site/agent-manifest.json`; build `--check` passes. Hosting: https://factgate.vercel.app/ (static, HTTPS; the manifest answers 200 with `Access-Control-Allow-Origin: *`) |
| 2 | Run with the site's default router and model; BYOK path | Default router Otari, model `alibaba/qwen3.8-flash`; BYOK in "AI model settings". Real-model run: steps above (needs a key) |
| 3 | Internal agent plus a grounded capability | `site/tests/agentified.test.mjs`: "the front agent asks the engine…" (website action), "evidence_verifier reaches vet402.com/mcp as an MCP tool" |
| 4 | After approval, load an exact named network from a second origin and run it locally | `factgate-peers/tests/three_sites.e2e.test.mjs` (sibling repo [github.com/kzmttkc/factgate-peers](https://github.com/kzmttkc/factgate-peers)): "6-4 ALLOW: Stay Steward asks FactGate, then loads Verified Stay by name…" (cards before contact, `remote_fetch` of `factgate` and `verified_stay`, both networks run on the caller's page) |
| 5 | The second site never receives the key and cannot change the router | Same tests, `checkKeyStaysHome`: no request to any site carries the key or `Authorization`; every model call goes to the caller's router; a stay manifest that names its own router gets no request |
| 6 | Private context absent at the peer unless a named field is allowed | Same tests, `checkPrivateContext`: partners receive only `target_url`; the trip dates and guest name appear in no model call and no request. Screen: Stay Steward's gate log ("Private context sent to FactGate: target_url") |
| 7 | Invalid network, cycle, over budget, denied origin stop with visible errors | e2e tests "6-7 over budget", "6-7 denied origin (policy)", "6-7 denied origin (visitor)", "6-7 invalid network", "6-7 cycle"; each stop is a line in Stay Steward's gate log |

## How a partner site uses FactGate

FactGate shares two actions through its bridge (`site/bridge/bridge-actions.js`) with every site: `get_gate_state` (pure, in a hidden frame) and `gate_check(url)`. `gate_check` contacts other origins, so it runs in FactGate's own window, where the visitor approves each origin first. The reference runtime opens a partner's window only for actions marked `write`, so `gate_check` is marked `write` with `confirmsInWindow`. It changes nothing. There is no shared `evaluate_gate`: a verdict comes only from a check FactGate measured. `install()` wraps `engine.requestConsent`, `actions.execute` and the trace listener (`site/factgate-gate.mjs`) so a blocked partner is not fetched.

### Put the gate in your own site (three lines)

`site/factgate-gate.mjs` is one file with no imports, for any site that runs the reference runtime. Copy it next to your page, then:

```js
import { FactGateGate } from "./factgate-gate.mjs";
const gate = new FactGateGate({ factgateUrl: "https://<factgate host>/factgate", pageOrigin: location.origin, policy: { passCaution: ["identity_unknown"] } });
gate.install(engine); // engine = boot(...).engine; gate.check(engine, url) runs a check from your own button, no model needed
```

The gate is page code in front of the runtime's consent step: a partner network is declined before its card (and nothing is fetched from it) unless FactGate checked it in this visit and the verdict passes the policy. ALLOW always passes, BLOCK never does, and a CAUTION passes only when every kind in it is listed in `passCaution` (`identity_unknown`, `unreachable`, `steering`, `no_delivery_record`, `declined`, `not_compared`, `delivery_warn`). **The default passes no CAUTION.** Stay Steward uses `["identity_unknown"]`: a stay that answers as declared but has no ERC-8004 registration may be linked; one that did not answer, steers the caller, or was blocked is not. Every stop is a line passed to `record`.

Stay Steward ([factgate-peers](https://github.com/kzmttkc/factgate-peers)) uses a byte-identical copy (`stay-steward/js/factgate-gate.mjs`, checked by its tests) and has a **Check with FactGate** button that runs the whole flow without a model or key: the card for FactGate, FactGate's network loaded by name, `gate_check` in FactGate's window, then either Verified Stay's card, its network and its booking window, or a stop with the reasons.

## Rules worth knowing

- **Consent.** Round 1 card: the counterparty's origin and the NANDA Index. Round 2: what reading it showed is needed (chain RPC, vet402.com, MCP servers it declares). Each row is allowed or declined on its own. A declined origin is never contacted, and its pillar becomes CAUTION. "Allow selected for this visit" is remembered per origin until the page closes, only when chosen.
- **Redirects.** FactGate never lets the fetch follow a redirect. A redirect whose `Location` can be read is a new destination: it goes back through the consent check, so another origin gets its own card and no request before it (`test/redirect.test.mjs`). A browser hides the `Location` of such a redirect, so on the page a redirect is recorded as not followed.
- **Measurements, not model values.** `website_evaluate_gate` and `website_save_check` take only the `measurementId` that `website_gate_check` (or `website_check_seller`) returned; they never accept pillar values a model wrote. The Developer form's hand-entered verdicts are kept in their own list, marked "hand-entered, not measured".
- **NANDA Index.** `manifest_inspector` (and every full check) reads `https://api.nandaindex.org/api/v1/index` and shows the one matching record (by URL host, `urn:air:` id, orgId or name). A listing is shown, not counted in the verdict.
- **Trusted validators.** A validation score counts only when its validator is on the list for that chain (`site/validators.json`, editable on the page; stored in the visitor's browser). The default lists only validators whose every score anyone can recompute from public records: the Delivery Court judge, which is **the author's own** validator (recompute with `offchain/src/rejudge.mjs` in github.com/kzmttkc/reactive-delivery-court). Other validators' scores are shown with the reason, never counted; self-scores never count. AgentFacts carries `x_factgate_validators`.
- **Free sites.** A site that asks for no payment passes pillar 2 when pillar 1 passed and the site and its ERC-8004 registration point at each other (the site's `/.well-known/agent-registration.json` names the agentId; the registration's `services` or agentURI names the site). One direction only stays CAUTION.
- **Instructions scan.** Text that tells the caller's model to ignore its rules, reveal its prompt or context, or go to an undeclared site is CAUTION; text that asks for a key, password or seed phrase is BLOCK. A sentence that forbids the thing ("Never ask for passwords") is not a finding; the published networks of FactGate, the demo sites and the reference examples produce none (`test/rules.test.mjs`). It is a static check and can be evaded by rewording.
- **AgentFacts.** Field names from arXiv:2507.14263 (appendix, V0.3 draft); FactGate's fields start with `x_factgate_`. `x_factgate_evidence` is a list of `{url, sha256, status, at}` for every HTTP response body FactGate read; pillar detail lives under `x_factgate_detail`. After a check in the browser, FactGate signs the JSON with a per-session ECDSA P-256 key (`x_factgate_signature`): that proves the file was not changed after measurement in that session; it does not prove the counterparty is safe, and the key is not an identity.

## Files

| Path | What |
| --- | --- |
| `site/js/gate.mjs` | The verdict engine (pure functions) |
| `site/js/probe.mjs`, `instructions.mjs` | Pillar 1 |
| `site/js/chain.mjs` | Pillar 2 (ERC-8004 IdentityRegistry reads, binding in both directions) |
| `site/js/validation.mjs`, `validators.mjs`, `site/validators.json` | Pillar 3's ValidationRegistry source and the trusted list |
| `site/js/gatecheck.mjs`, `reads.mjs` | One full check, shared by the page, the bridge and the probe script |
| `site/js/consent.mjs`, `consent-card.mjs` | Consent rounds, redirects as new destinations, and the per-row card |
| `site/js/nanda.mjs` | NANDA Index lookup |
| `site/factgate-gate.mjs` | The gate other sites load (policy, page-code check); see [docs/GATE.md](docs/GATE.md) |
| `site/js/card.mjs`, `app.js`, `index.html`, `styles.css` | The page |
| `site/factgate.hocon`, `agent-manifest.json`, `site-actions.js`, `bridge/` | The agentic website (network, manifest, actions, bridge) |
| `site/runtime/` | Reference runtime with `settingsDefaultClosed` in `ui.js` (AI model settings start closed on the page). Apache-2.0 from the Open Agentic Web reference runtime (see `site/runtime/LICENSE.txt`) |
| `scripts/probe-live.mjs`, `cors-fetch.mjs` | Live measurement with the browser's CORS rules |
| `evidence/live/` | Measured results |

## Tests

### Run the tests from a fresh clone

```shell
mkdir -p demo && cd demo
git clone https://github.com/kzmttkc/factgate
git clone https://github.com/kzmttkc/factgate-peers
git clone https://github.com/cognizant-ai-labs/agentic-web
```

From each checkout (sibling layout; optional `AGENTIFY_SKILL=../agentic-web/skills/agentify-website` when building networks):

```shell
cd factgate
node --test "test/*.test.mjs" "site/tests/*.test.mjs"

cd ../factgate-peers
node --test "*/tests/*.test.mjs" "tests/*.test.mjs"
```

| Suite | Expected (2026-11-22) |
| --- | --- |
| `node --test "test/*.test.mjs" "site/tests/*.test.mjs"` (in `factgate`, counted 2026-11-23) | 193: 186 pass, 0 fail, 7 skipped (template tests for irreversible actions; FactGate has none) |
| `node --test "*/tests/*.test.mjs" "tests/*.test.mjs"` (in `factgate-peers`, with `../factgate`) | 56: 56 pass, 0 fail (10 three-site end-to-end tests, 2 of those run the no-model button) |

CI smoke in evidence packs: `node --test test/*.test.mjs` only (166 tests as of 2026-11-23). Use the full factgate command above for 193.

## Limits

- Redirects are not followed in a browser (the browser hides where they point); a counterparty whose files sit behind a redirect reads as unreachable until it serves them directly.
- The deployed build rewrites only the four demo origins (`deploy/public-origins.json`). Vercel sends `Access-Control-Allow-Origin: *` on every static file by default, a wider set than serve_site.mjs opens locally; the files are all public.
- The real-model path is not covered by the tests (it needs a key); the steps above check it by hand.
- The reference runtime applies one private-context allow rule per calling network, so Verified Stay also receives `target_url` (its own URL). Destination-scoped rules are a spec section 5 extension.
- vet402 records public https sellers only; local demo sites get pillar 3 from validation scores.
- The agent402.tools ALLOW path calls `https://vet402.com/mcp` (`site/js/gatecheck.mjs`). Allow vet402.com on the consent card when measuring pillar 3.
- Verified Stay checks need a consent-card row for `https://sepolia.base.org` (Base Sepolia RPC). Public RPCs may rate-limit. If the gate stops with `no_delivery_record`, wait and retry once.
- agent402.tools is a third-party seller. Pillar 3 for that URL depends on vet402.com/mcp and the validators in `validators.json` (`evidence/public/SUMMARY.json`, measured 2026-11-22).
