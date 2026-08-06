# FormaJS documentation

The README answers *what is this, why does it exist, how do I start, where do I
go next*. Everything with depth is here.

## Using FormaJS

| Document | What it answers |
|---|---|
| [API.md](API.md) | `h()`, signals, control flow, stores, components, context, async, portals — the whole programmatic surface, including the four unsanitized escape hatches |
| [HTML-RUNTIME.md](HTML-RUNTIME.md) | The zero-build `data-*` runtime: every directive, and the CSP-safe expression grammar with its limits |
| [ISLANDS.md](ISLANDS.md) | Hydrating server-rendered HTML: getting props in, seeding signals from server data, keyed list adoption, triggers, disposal |
| [CDN-AND-EXPORTS.md](CDN-AND-EXPORTS.md) | Which build to load from a CDN, and what each subpath export contains |
| [COMPARISONS.md](COMPARISONS.md) | Coming from React (and the one habit to break), and how this differs from Solid |
| [STABILITY.md](STABILITY.md) | What is stable, what is beta, and the one known gap |

## Guarantees and measurements

| Document | What it answers |
|---|---|
| [`../SECURITY.md`](../SECURITY.md) | Threat model, what is guarded, what is explicitly not |
| [`../CSP.md`](../CSP.md) | Running under a strict Content-Security-Policy, and what to do when an expression is refused |
| [PERFORMANCE.md](PERFORMANCE.md) | Benchmarked hot paths, each with its run-to-run noise floor so a later comparison can tell a regression from a bad afternoon |
| [HARDENING-AUDIT.md](HARDENING-AUDIT.md) | The 2026-08 hardening ledger: every finding, its fix, and the test that pins it |
| [TEST-SUITE-AUDIT.md](TEST-SUITE-AUDIT.md) | The mutation-probe audit of this suite and the remediation plan it produced |

## Design records

| Document | Status |
|---|---|
| [design/CSP-SAFE-EXPRESSION-GRAMMAR.md](design/CSP-SAFE-EXPRESSION-GRAMMAR.md) | **Shipped** — the regex expression cascade and the `new Function` fallback were replaced by the allowlist AST interpreter in `src/expr/`. Read it for the reasoning and the rejected alternatives; read [HTML-RUNTIME.md](HTML-RUNTIME.md) and [../SECURITY.md](../SECURITY.md) for what the code now does. Its cost projection was wrong in one place — it estimated roughly break-even on bundle size and the shipped engine is ~6 KB gzipped larger. |

A design record is written *before* the work and kept afterwards. It says what
was decided, what was rejected and why, and what the decision costs. It is not
documentation of current behaviour — every one carries a status banner saying
so.

## The rest of the stack

FormaJS is the client runtime of a four-repo product:

```
TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
         forma-tools                          forma                    THIS REPO
```

- [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)
  — read this first if you are new to the stack. §3 specifies the contracts
  this runtime shares with the server: hydration markers, `data-forma-*`
  attributes, the island props protocol.
- [Testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md)
  — the standard every test here is held to.
- [FMIR format](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md)
  — the binary the Rust server renders from.

## House rules

1. A documented behaviour cites the test that proves it, in the form
   ``Verified by `<repo-relative test path>` > "<exact test name>"`` — see any
   page here for real ones. A claim that cannot be tested is written as
   mechanism or rationale, not as a guarantee.
2. Numbers are re-measured, never copied between documents. Say when a
   measurement was taken.
3. Superseded material moves to [archive/](archive/) with an entry saying what
   it was, when it was retired and why. Nothing is deleted.
