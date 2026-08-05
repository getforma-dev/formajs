# Contributing to FormaJS

## Setup

Node **>= 20.19.0** is required for development — that is the floor `vite`
declares, and `package.json`'s `engines` / `devEngines` state it so `npm ci`
warns instead of failing later in a confusing way. CI runs the same floor.

```bash
git clone https://github.com/getforma-dev/formajs.git
cd formajs
npm install
npm test        # run tests
npm run build   # build dist/ (ends with scripts/verify-dist.mjs)
```

## Development

- `npm test` — run vitest
- `npm run test:watch` — watch mode
- `npm run test:e2e` — build dist, then run Playwright against the real artifacts
- `npm run build` — build all output formats, then verify them
- `npm run check:size` — gzip the real ESM import graph per entry (the CI gate)
- `npm run check:pack` — `publint` + `@arethetypeswrong/cli`
- `npm run typecheck` — type check without emitting (covers `tsup.config.ts` and `scripts/`)

## Code Style

- Use `h()` for all DOM creation — never `document.createElement` in library code
- Reactive values must be functions: `() => count()` not `count()`
- Components are pure rendering — no side effects in render functions
- Tests go in `__tests__/` directories next to their source

## Comments that assert must cite their proof

A comment claiming a security or behavioural property is worse than no comment
when it is wrong, because it stops the next reader from checking. An audit of
this repo found a URL-safety module describing a control that did not exist, a
`__DEV__` docstring promising dead-code elimination that never happened, and a
`SECURITY.md` calling a proxy a sandbox. All three read as authoritative.

**The rule.** If a comment asserts a property — a guarantee, a "never"/"always",
an invariant, a complexity bound, "this is handled", "this cannot happen" — it
ends with the test that proves it, on its own line, in exactly this form:

```
// Verified by: <repo-relative test path> > "<exact test name>"
```

### Worked example

You are about to write this:

```ts
/** Strips prototype-pollution keys, so a malicious payload can never reach Object.prototype. */
function parseState(raw: string): Record<string, unknown> { … }
```

That sentence is a security claim. Work through the four cases:

1. **True and tested** — find the test and cite it. Done.
2. **True but untested** — *write the test first*, then cite it. This is the
   common case and it is the point of the rule: the claim is what tells you
   which test is missing.
3. **False or stale** — if the comment describes the behaviour you want, fix the
   code; otherwise rewrite the comment to say what the code actually does.
4. **Not testable** (browser behaviour, a design rationale, a judgement call) —
   do not phrase it as a guarantee of *our* code. Describe the mechanism and
   mark it plainly as rationale.

The finished version, after writing the missing test:

```ts
/**
 * Parse a `data-forma-state` attribute into the plain object a scope is built
 * from. Anything else — invalid JSON, but equally the *valid* JSON values
 * `null`, `7`, `"str"` and `[1,2]` — yields `{}`.
 *
 * Verified by: src/__tests__/runtime-state-parsing.test.ts > "a __proto__ key in data-forma-state never reaches Object.prototype"
 */
function parseState(raw: string): Record<string, unknown> { … }
```

### The citation must be able to fail

A citation pointing at a test that cannot fail is worse than no citation. Before
you commit one, break the property in your working copy and confirm the cited
test goes red. Two zero-signal suites were deleted from this repo for failing
that check: one re-implemented the function under test inside the test file, the
other asserted `expect(el).toBeTruthy()` on markup its own helper had just
written.

### Markdown carries the same rule

`README.md`, `SECURITY.md`, `CSP.md`, this file, and `docs/HARDENING-AUDIT.md`
use the backticked path form:

```
Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml when no tag is supplied"
```

The hardening ledger is held to it hardest: an entry marked FIXED is a claim that
a defect is gone, so it names the test that proves it. An entry that cannot be
closed that way says WONTFIX and why. Nothing is left ambiguous.

### A number cites the benchmark that produced it

A performance claim is an assertion like any other, and it goes stale faster —
so it carries the same citation in its own form:

```
Benchmarked by: bench/list.bench.ts > "same keys, same order — reconciler fast path"
```

Benchmark names are assembled from template literals (`(×${NODES})`,
`${width} effects on one signal`), so unlike test names they cannot be grepped
out of the source. They resolve instead against `docs/performance-baseline.json`
— the committed record of what `npm run bench:doc` actually ran, which holds
every rendered name. Renaming a benchmark therefore means re-running the suite,
which rewrites that file, which is what makes a stale citation fail.

Two rules for the numbers themselves, both from `docs/PERFORMANCE.md`: quote the
median, never the mean (one GC pause ruins a mean), and do not quote a difference
smaller than that benchmark's run-to-run spread — the table prints the spread
next to every row precisely so that check is possible.

### It is enforced

`src/__tests__/docs-truth.test.ts` resolves **every** citation against the test
file and test name it names, and fails on any that does not resolve. It covers
the five markdown files above plus `docs/PERFORMANCE.md`, every `.ts`/`.mjs` file
under `src/` and `scripts/`, `tsup.config.ts`, and the workflow YAML under
`.github/workflows/` —
a citation in a YAML comment is a claim like any other. It also checks the claims
that can be read straight off the repo: version pins (including the CDN pin in
the `src/runtime.ts` header), artifact names, export coverage, the `runtime.ts`
section map, coverage figures and size limits.

Verified by: `src/__tests__/docs-truth.test.ts` > "every citation names a test file that exists and a test that is in it"
Verified by: `src/__tests__/docs-truth.test.ts` > "every code comment citation resolves to a test that exists"
Verified by: `src/__tests__/docs-truth.test.ts` > "every benchmark citation names a benchmark the suite actually ran"

## What must not change

The hydration wire contract is shared byte-for-byte with the Rust walker in the
`forma` repo and with ksx Studio: the `f:tN` / `f:sN` / `f:lN` / `f:iN` comment
markers, the `data-forma-*` attribute names, the `__forma_islands` script
protocol and its props JSON shape, and the FMIR binary layout. Everything else
is fair game.

## Pull Requests

1. Fork and create a feature branch
2. Add tests for new functionality — a regression fix needs a test that fails
   without it
3. Ensure `npm test`, `npm run typecheck` and `npm run build` pass
4. Add a `## [Unreleased]` entry to `CHANGELOG.md` for anything user-visible
5. Submit PR with clear description
