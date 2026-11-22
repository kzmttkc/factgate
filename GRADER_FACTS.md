# FactGate — facts for graders (2026-11-22, local build, not yet deployed)

Contest: Open Agentic Web Challenge (Cognizant, Devpost). Theme: "Agentify a website, create a tool that helps agents find or trust each other, or a reusable component the whole community can leverage." Stage 2 = 4 equal criteria: Technological Implementation, Design ("complete, coherent product experience not just a technical proof of concept"), Potential Impact ("credible, specific case for solving a real problem for a real audience"), Quality of the Idea.

## Stage 1 (pass/fail): both the rules' Submission Requirements and spec section 6

Submission Requirements (contest rules, as read 2026-11-21/22; re-read before submitting):

| Requirement | Status |
| --- | --- |
| A public open agentic website: spec-conforming `.json` files, the browser `runtime`, a working interface | Built and tested locally (`site/`). Not deployed yet |
| Text description of the features | README.md (English); submission text not written yet |
| Video under 2 minutes, on YouTube, "must include the Entrant explaining the Project (not AI generated)" | Not recorded yet (author's own voice) |
| Screenshots | Not taken yet (the page checked at 1440 px and 390 px) |
| Free access to the working demo through judging | Pending deployment |
| A project that existed before the period "must have been significantly updated after the start of the Hackathon Submission Period" (2026-11-11) | FactGate was started 2026-11-22 |

MVP spec section 6 (each with the test or screen that shows it; details in README "Spec section 6"):

| # | Check | Evidence |
| --- | --- | --- |
| 1 | Two-agent HOCON network + manifest on an ordinary HTTPS host | Four agents, build `--check` OK. HTTPS hosting pending |
| 2 | Run with the published default router/model; BYOK path | Otari default + BYOK settings. Real-model run needs a key: manual steps in README |
| 3 | Internal agent + MCP or local action | Template tests with a scripted model; vet402.com/mcp as the MCP tool |
| 4 | After approval, load an exact named network from a second origin and run it locally | `factgate-peers/tests/three_sites.e2e.test.mjs` "6-4 ALLOW" |
| 5 | Key never reaches the second site; it cannot change the router | Same file, `checkKeyStaysHome` (every run) |
| 6 | Private context absent at the peer unless a named field is allowed | Same file, `checkPrivateContext`; Stay Steward's gate log |
| 7 | Invalid network, cycle, over budget, denied origin stop visibly | Same file, five "6-7" tests; Stay Steward's gate log |

## What it is

An open agentic website that checks a counterparty (an agentic website, a NANDA-indexed agent, or an x402 seller) before an agent links to it or pays it. Runs entirely in the browser (no server code). Every contact goes through a consent card that lists each destination origin and what it gets. Returns a deterministic ALLOW / CAUTION / BLOCK (code decides, the LLM only explains) and an AgentFacts JSON (field names from arXiv:2507.14263 appendix; extensions prefixed x_factgate_).

Three pillars:
1. Live probe: manifest (spec 3.3), network, declared MCP `initialize`→`tools/list`, x402 terms (never paid), paid resource, and a static scan of the instructions a caller would load (steering = CAUTION, asking for keys = BLOCK). Unreachable over CORS is recorded as such (no proxy).
2. Identity binding: ERC-8004 IdentityRegistry via eth_call (Base, Base Sepolia, Celo), pinned to one block, compared with the 402 payTo. A free site passes when pillar 1 passes and the site and its registration point at each other.
3. Delivery evidence: vet402.com production records, and ERC-8004 ValidationRegistry scores from trusted validators only (`validators.json`; default = the Delivery Court judge, the author's own, recomputable with a public script). Others' scores shown, not counted. Free targets: "not applicable", never called a pass.

Composition demo (fictional sites, author-run, disclosed): Stay Steward loads FactGate, Verified Stay and Glossy Stay by name (links.json), asks FactGate first, and its page code never loads a stay FactGate blocked or did not check.

Live results (11/22, `evidence/live/SUMMARY.json`): agent402.tools = ALLOW; vet402.com (author's own) = ALLOW via the mutual-binding rule; Verified Stay = ALLOW; Glossy Stay = BLOCK; Stay Steward = CAUTION; five contest-listed sites = CAUTION (no ERC-8004 registration); organizer's widget = CAUTION (manifest not CORS-readable).

Tests: FactGate 146 (139 pass, 0 fail, 7 skipped: irreversible-action template tests, not applicable). Demo sites 50 (50 pass), including 7 three-site end-to-end tests with a scripted model (also passed against the real Base Sepolia RPC).

Competitors already listed: Agent Atlas (manifest format check), NandaSeal (browser self-signed facts), Agent Customs (static prompt-injection scan), Agent Crash Test (own-site confirm dialogs), Three Numbers (XRPL escrow counts).

Not yet done: deployment, the real-LLM chat run (needs the author's key), NANDA Index lookup in manifest_inspector, video, screenshots, submission text.
