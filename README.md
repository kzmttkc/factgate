# FactGate

**Check a counterparty before your agent links to it or pays it.**

FactGate is an open agentic website (Worldwide Agentic Web MVP spec) that answers one question for an agent builder or a visitor: *is it safe to connect to this agent site, NANDA-listed agent or x402 seller?* It measures three things from the browser and returns a deterministic **ALLOW / CAUTION / BLOCK** with the evidence, plus an AgentFacts JSON.

| Pillar | What FactGate measures | Source |
| --- | --- | --- |
| 1. Answers as declared | The manifest (spec 3.3), the network definition, every declared MCP server (`initialize` → `tools/list`), the x402 terms (read, never paid), the declared paid resource, and a static scan of the instructions a caller would load (spec section 5, "Untrusted instructions") | The counterparty, over CORS |
| 2. Identity on chain | The ERC-8004 registration the site declares, read with `eth_call` and pinned to one block; its owner and agentWallet compared with the 402 `payTo`. A free site passes when the site and its registration point at each other | Base, Base Sepolia, Celo |
| 3. Delivered after payment | vet402's production record of paid calls that came back with content, and ERC-8004 ValidationRegistry scores from **trusted** validators only | vet402.com/mcp, ValidationRegistry |

The verdict is code (`site/js/gate.mjs`): the worst pillar wins, a pillar that could not be read is CAUTION (never zero, never good), and the language model only explains. Nothing is paid or signed, and **nothing is contacted before the visitor approves a card that lists each destination origin and what it gets** (spec 3.2 Consent, section 5).

**How FactGate breaks self-declaration:** a site's own manifest, AgentFacts and signature only say who wrote the claims, so FactGate compares every claim with something the site does not control — what its endpoints actually answer, what the chain says its registered wallet is, and what came back when someone paid it.

## Who it is for

- **Agent sites that link to other agent sites.** Before your network loads a partner network (spec 3.2), ask FactGate. The demo booking agent, Stay Steward, does exactly that: it never loads a stay that FactGate blocks, and its gate is page code, not a prompt.
- **Agents that pay x402 sellers.** Check the seller's payee against its on-chain identity and its delivery record before the first payment.
- **People reviewing an agent site.** Paste a URL, get the three pillars, the request log and a downloadable AgentFacts file.

## Compared with the five tools already listed

| | Agent Atlas | NandaSeal | Agent Customs | Agent Crash Test | Three Numbers | **FactGate** |
| --- | --- | --- | --- | --- | --- | --- |
| What it checks | Manifest format | Self-signed facts in the browser | Static prompt-injection scan | Your own site's confirm dialogs | XRPL escrow counts | Live answers vs declarations, on-chain identity vs payee, delivery after payment |
| Calls the counterparty's endpoints | Manifest only | No | No | Your own site | No | Manifest, network, MCP `tools/list`, x402 terms, paid resource |
| Reads identity on chain | No | No | No | No | No (reads XRPL escrow counts) | ERC-8004 owner / agentWallet, pinned block |
| Evidence that paid calls delivered | No | No | No | No | Counts only | vet402 records + trusted ValidationRegistry scores |
| Verdict before linking or paying | No | No | Static only | No | No | ALLOW / CAUTION / BLOCK, used by a partner site's gate |

## Try it

Open the page, press one of **Try these** (agent402.tools, Verified Stay, Glossy Stay) or paste a URL, approve the cards, and read the verdict card: three pillars side by side with one line of evidence each, three counts on top (paid calls, calls that came back with content, passing validations; "—" when not measured), and the full request log, the approved origins and the AgentFacts under the fold.

Verdicts measured on 2026-11-22 (`node scripts/probe-live.mjs --peers`, `evidence/live/SUMMARY.json`):

| Counterparty | Verdict | Why |
| --- | --- | --- |
| agent402.tools/api/weather-forecast (real x402 seller) | ALLOW | Answers as declared; payTo = ERC-8004 agent 94639's owner and agentWallet on Base; vet402 delivered 3 of 3 paid calls |
| vet402.com (the author's own service) | ALLOW | No payment asked; the site and its ERC-8004 registration point at each other (rule C-1) |
| Verified Stay (fictional demo, local) | ALLOW | payTo = agent 10798's wallet on Base Sepolia; 79 scores of 70 or more from the trusted Delivery Court judge |
| Glossy Stay (fictional demo, local) | BLOCK | payTo is not its own declared wallet nor agent 10799's; the paid resource answers an empty body; a trusted score of 3 |
| Stay Steward (fictional demo, local) | CAUTION | Answers as declared; declares no ERC-8004 registration |
| Five agentic websites from the contest's list | CAUTION | Answer as declared; none declares an ERC-8004 registration, so identity is not measured |
| The contest organizer's widget | CAUTION | Its manifest answers without `Access-Control-Allow-Origin`, so a browser cannot read it |

## Run it

```shell
SKILL=~/factgate-ref/agentic-web/skills/agentify-website
cd ~/factgate

# Build the network from the .hocon (after any change to it or the manifest)
node $SKILL/scripts/build_network.mjs site/factgate.hocon --manifest site/agent-manifest.json --check

# Tests (no LLM, no network)
node --test "test/*.test.mjs" "site/tests/*.test.mjs"

# Serve the page with the CORS headers other sites need
node $SKILL/scripts/serve_site.mjs site --port 8790 --open-as localhost     # http://localhost:8790/

# Measure real counterparties with the page's own code (writes evidence/live/)
node scripts/probe-live.mjs            # agent402, the contest's list, vet402.com
node scripts/probe-live.mjs --peers    # plus the three demo sites (serve them first, see below)
```

### Run the three-site demo

The demo sites live in `~/factgate-peers` (README there). Serve all four on different host names, so a key saved on one page is never sent to another (runtime/byok.js mirrors keys to a cookie per host name):

```shell
cd ~/factgate-peers
node serve.mjs glossy-stay --port 8791                  # http://127.0.0.1:8791/
node serve.mjs verified-stay --port 8792                # http://127.0.0.1:8792/
node serve.mjs stay-steward --host ::1 --port 8793      # http://[::1]:8793/
```

Open Stay Steward, pick a stay, and ask the assistant to book it. Stay Steward asks FactGate first (a card), FactGate's window asks before each origin it reads, and only then is the stay's network loaded (another card) and the booking made in the stay's own window. With Glossy Stay the gate stops at FactGate's BLOCK and shows why.

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
| 1 | Two-agent HOCON network and manifest on an ordinary host | `site/factgate.hocon` (four agents) → `site/factgate.network.json`, `site/agent-manifest.json`; build `--check` passes. Hosting: not deployed yet |
| 2 | Run with the site's default router and model; BYOK path | Default router Otari, model `alibaba/qwen3.8-flash`; BYOK in "AI model settings". Real-model run: steps above (needs a key) |
| 3 | Internal agent plus a grounded capability | `site/tests/agentified.test.mjs`: "the front agent asks the engine…" (website action), "evidence_verifier reaches vet402.com/mcp as an MCP tool" |
| 4 | After approval, load an exact named network from a second origin and run it locally | `~/factgate-peers/tests/three_sites.e2e.test.mjs`: "6-4 ALLOW: Stay Steward asks FactGate, then loads Verified Stay by name…" (cards before contact, `remote_fetch` of `factgate` and `verified_stay`, both networks run on the caller's page) |
| 5 | The second site never receives the key and cannot change the router | Same tests, `checkKeyStaysHome`: no request to any site carries the key or `Authorization`; every model call goes to the caller's router; a stay manifest that names its own router gets no request |
| 6 | Private context absent at the peer unless a named field is allowed | Same tests, `checkPrivateContext`: partners receive only `target_url`; the trip dates and guest name appear in no model call and no request. Screen: Stay Steward's gate log ("Private context sent to FactGate: target_url") |
| 7 | Invalid network, cycle, over budget, denied origin stop with visible errors | e2e tests "6-7 over budget", "6-7 denied origin (policy)", "6-7 denied origin (visitor)", "6-7 invalid network", "6-7 cycle"; each stop is a line in Stay Steward's gate log |

## How a partner site uses FactGate

FactGate shares three actions through its bridge (`site/bridge/bridge-actions.js`) with every site: `get_gate_state` and `evaluate_gate` (pure, in a hidden frame) and `gate_check(url)`. `gate_check` contacts other origins, so it runs in FactGate's own window, where the visitor approves each origin first. The reference runtime opens a partner's window only for actions marked `write`, so `gate_check` is marked `write` with `confirmsInWindow`; it changes nothing. A caller that wants a hard gate does what Stay Steward does: read FactGate's verdict from the action receipt and decline the card for a stay that was blocked or never checked (`~/factgate-peers/stay-steward/js/gate-keeper.mjs`).

## Rules worth knowing

- **Consent.** Round 1 card: the counterparty's origin only. Round 2: what reading it showed is needed (chain RPC, vet402.com, MCP servers it declares). A declined origin is never contacted, and its pillar becomes CAUTION. "Allow for this visit" is remembered per origin until the page closes, only when chosen.
- **Trusted validators.** A validation score counts only when its validator is on the list for that chain (`site/validators.json`, editable on the page; stored in the visitor's browser). The default lists only validators whose every score anyone can recompute from public records: the Delivery Court judge, which is **the author's own** validator (recompute with `offchain/src/rejudge.mjs` in github.com/kzmttkc/reactive-delivery-court). Other validators' scores are shown with the reason, never counted; self-scores never count. AgentFacts carries `x_factgate_validators`.
- **Free sites.** A site that asks for no payment passes pillar 2 when pillar 1 passed and the site and its ERC-8004 registration point at each other (the site's `/.well-known/agent-registration.json` names the agentId; the registration's `services` or agentURI names the site). One direction only stays CAUTION.
- **Instructions scan.** Text that tells the caller's model to ignore its rules, reveal its prompt or context, or go to an undeclared site is CAUTION; text that asks for a key, password or seed phrase is BLOCK. A sentence that forbids the thing ("Never ask for passwords") is not a finding; the published networks of FactGate, the demo sites and the reference examples produce none (`test/rules.test.mjs`). It is a static check and can be evaded by rewording.
- **AgentFacts.** Field names from arXiv:2507.14263 (appendix, V0.3 draft); FactGate's fields start with `x_factgate_`; unsigned, because FactGate is not an issuer.

## Files

| Path | What |
| --- | --- |
| `site/js/gate.mjs` | The verdict engine (pure functions) |
| `site/js/probe.mjs`, `instructions.mjs` | Pillar 1 |
| `site/js/chain.mjs` | Pillar 2 (ERC-8004 IdentityRegistry reads, binding in both directions) |
| `site/js/validation.mjs`, `validators.mjs`, `site/validators.json` | Pillar 3's ValidationRegistry source and the trusted list |
| `site/js/gatecheck.mjs`, `reads.mjs` | One full check, shared by the page, the bridge and the probe script |
| `site/js/consent.mjs`, `consent-card.mjs` | Consent rounds and the card |
| `site/js/card.mjs`, `app.js`, `index.html`, `styles.css` | The page |
| `site/factgate.hocon`, `agent-manifest.json`, `site-actions.js`, `bridge/` | The agentic website (network, manifest, actions, bridge) |
| `site/runtime/` | The reference runtime, unchanged |
| `scripts/probe-live.mjs`, `cors-fetch.mjs` | Live measurement with the browser's CORS rules |
| `evidence/live/` | Measured results |
| `NOTES_ja.md` | Work log in Japanese |

## Tests

| Suite | Tests (2026-11-22) |
| --- | --- |
| `node --test "test/*.test.mjs" "site/tests/*.test.mjs"` | 146: 139 pass, 0 fail, 7 skipped (template tests for irreversible actions; FactGate has none) |
| `~/factgate-peers`: `node --test "*/tests/*.test.mjs" "tests/*.test.mjs"` | 50: 50 pass, 0 fail (7 of them are the three-site end-to-end tests) |

## Limits

- Not deployed yet. Before hosting, the demo URLs (`127.0.0.1`, `localhost`, `[::1]`) in `site/js/examples.mjs` and in the demo sites must change to https URLs.
- The real-model path is not covered by the tests (it needs a key); the steps above check it by hand.
- The reference runtime applies one private-context allow rule per calling network, so Verified Stay also receives `target_url` (its own URL). Destination-scoped rules are a spec section 5 extension.
- vet402 records public https sellers only; local demo sites get pillar 3 from validation scores.
