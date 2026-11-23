# factgate-gate.mjs

Versioned reusable gate (`export const VERSION` in the file; pin by commit and verify `sha256` when copying).

## Install (three lines)

```js
import { FactGateGate } from "./factgate-gate.mjs";
const gate = new FactGateGate({ factgateUrl: "https://<factgate host>/factgate", pageOrigin: location.origin });
gate.install(engine); // engine = boot(...).engine
```

Copy `site/factgate-gate.mjs` next to your page (Stay Steward keeps a byte-identical copy). Load FactGate's network URL you trust; `pageOrigin` is your site's origin.

## Policy options

`policy.passCaution` lists CAUTION kinds that may still link to a partner. ALLOW always passes; BLOCK never passes.

| Kind | Meaning |
| --- | --- |
| `identity_unknown` | No ERC-8004 registration could be read |
| `unreachable` | Site or a declared capability did not answer |
| `steering` | Instructions try to steer the caller's model |
| `no_delivery_record` | No vet402 delivery record |
| `declined` | Visitor declined an origin on the consent card |
| `not_compared` | Answer not compared with declaration |
| `delivery_warn` | vet402 answers WARN |

Default: `passCaution: []` (no CAUTION passes). Example: `{ passCaution: ["identity_unknown"] }` — Stay Steward's policy.

`gate.check(engine, url)` runs FactGate's `gate_check` from page code with no model.

## What it blocks

Before the runtime's consent card for a partner network, the gate declines when:

- FactGate has not checked that host in this visit
- FactGate answered BLOCK
- FactGate answered CAUTION with any kind not in `passCaution`

Declined partners are never fetched. Stops (gate, over budget, invalid network, cycle, denied origin, declined card) go to `record` for the page log.

## Pin the version

- Read `VERSION` from the file you ship (`1.0.0` today).
- Pin by the FactGate repo commit you copied from, then check `sha256` of `site/factgate-gate.mjs` before deploy. Current hash: `d0cb13f0e66b49130c24d95832812414f21eb3369c249e00348f9c959e7d1cf3` (`VERSION` `1.0.0`).
- Stay Steward's test asserts its copy matches `site/factgate-gate.mjs` byte for byte.