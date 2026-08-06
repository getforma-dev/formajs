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

## Writing a test that can fail

The citation rule above says a claim must name its proof. This section says what
makes something a proof.

A 2026-08 audit mutation-probed this suite one surgical break at a time, against
the 93-probe corpus now committed at `probes/corpus.json`. It detected **64%**
of those defects overall, **72%** on security-relevant code and **33%** on the
SSR renderer — the one component whose output goes straight into a browser. Two
whole files named for security controls passed with the control deleted from
production code. Every rule below is derived from a defect that shipped, not
from general advice; `docs/TEST-SUITE-AUDIT.md` records which one, and what the
same corpus reports today.

### The eight rules

1. **Assert the guarantee, not the mechanism.** A spy count, a throw, or a
   markup shape is evidence *about* the implementation. Every
   `toHaveBeenCalled*` / `toThrow` / `not.toThrow` must be followed, in the same
   test, by an assertion on rendered output, returned value, or observable
   state. `expect(renderCount).toBe(1)` is satisfied by a cache that returns an
   empty branch.

2. **When N paths share a guarantee, the assertion lives in ONE shared table.**
   This repo has six attribute sinks — SSR `renderToString`, `h()` static,
   `h()` reactive, hydration adoption, the `data-bind:` binder, and
   `$el.setAttribute()` in the expression grammar. Historically each guarantee
   was asserted on exactly one of them, and that single habit produced 7 of the
   25 code defects in the hardening ledger. The table is
   `src/__tests__/renderer-contract.test.ts`. A new sink joins it, or that
   file's own completeness test fails.

3. **Two-sided assertions: absence AND presence.** `not.toContain('javascript:')`
   is satisfied by a renderer that emits no attributes at all — a probe that
   dropped *every* prop survived all four "blocks …" tests. Every "we block X"
   test renders X alongside a benign sibling and asserts both halves. Prefer
   exact-output `toBe` over fragment `toContain` for anything producing markup.

4. **Depth floors.** State machines (show / switch / portal / hydrate branches):
   **>= 3 transitions**, invariant asserted after *every* transition. Lists:
   **>= 2 items** for every behaviour and **>= 40 items** for anything touching
   the keyed algorithm (`SMALL_LIST_THRESHOLD` is 32 — both sides get
   exercised). Islands: **>= 2 instances**, because cross-island isolation is
   invisible with one. Recursive parsers: a fixture at **depth >= 10 000**.
   And **branches must be distinguishable** — a `show` whose two branches both
   render the text "Truthy" cannot detect a mislabelled cached fragment.

5. **Adversarial input is mandatory for anything parsing untrusted data.** JSON,
   URLs, attribute values, HTML strings, RPC bodies. Hostile keys
   (`__proto__`, `constructor`, `prototype`) built with `JSON.parse`, not object
   literals. Plus two corollaries that are easy to miss: every blocklist needs
   an **allow-list** test (`DANGEROUS_SCHEME_RE` is anchored with `^`; removing
   the anchor makes it a substring match and only
   `https://example.com/guides/javascript` notices), and every allowlist is
   tested for **completeness, not contents** — `describe.each(URL_ATTRS)`, never
   a hand-picked `href` and `src`.

6. **A test must be able to fail.** If deleting the feature does not turn the
   test red, it is not a test. Three shapes that cannot fail: a body with no
   `expect()`; an assertion true by construction (`toBeUndefined()` on a name
   that was never exported passes with any typo); and reading a mock's own
   configured return value back out.

7. **No self-skipping tests.** No `existsSync` guard that returns, no `it.skip`,
   no environment sniffing. Fixtures live in the repo. A check that genuinely
   needs a build artifact is a separate CI job that fails loudly.

8. **Mock almost nothing, and never the thing under test.** Legitimate: browser
   APIs happy-dom does not implement (`ResizeObserver`, `IntersectionObserver`),
   the network boundary, the clock, cross-process boundaries. Even then, assert
   the *effect*, not the mock's arguments. If a function is private and that
   pushes you toward simulating it, export it.

### The reviewer's checklist

1. Does every `toHaveBeenCalled*` / `toThrow` in this diff have an
   observable-outcome assertion after it?
2. Does this guarantee exist on a sibling path (SSR / `h()` / hydrate /
   `data-bind` / `$el`)? If yes, is the assertion in the **shared table**?
3. Does the "we block X" test also assert a benign sibling survives?
4. State machine → >= 3 transitions? List → >= 2 items and a >= 40-item case?
   Islands → >= 2 instances? Recursive parser → a >= 10 000-depth case?
5. Are the fixture's branches/values **distinguishable** — could a swap of two
   things pass?
6. Does this parse untrusted input? Where are the hostile keys, the allow-list
   (negative-space) cases, and the completeness test over the allowlist?
7. **Did you break the feature and watch this test go red?** State the mutation
   in the PR description, one line:
   `Probe: deleted the isDangerousUrl call in renderAttr -> 5 tests failed.`
8. Any `existsSync` guard, `it.skip`, or test with no `expect()`? Any new
   `vi.mock` of a first-party module? Justify or remove.

A `Verified by:` comment requires item 7 against **that specific test**, or it
does not go in. A citation pointing at a test that cannot fail is strictly worse
than no citation: no comment leaves a reader appropriately suspicious, while a
false one converts suspicion into confidence at exactly the moment they are
deciding whether to look harder.

### It is enforced

Rules 6, 7 and 8 are mechanical, so they are checked rather than reviewed.
`src/__tests__/test-policy.test.ts` runs inside `npm test` in well under a
second and fails the build on: a test with no `expect()`; a test file that
touches no production code; `it.skip` / `describe.skip` / an `existsSync` guard
that returns; a test whose only assertions are presence checks; a file that is
90% one identical assertion; and `vi.mock` of a first-party module without
`importOriginal`.

Verified by: `src/__tests__/test-policy.test.ts` > "every test declaration contains at least one expect()"
Verified by: `src/__tests__/test-policy.test.ts` > "no test skips itself"
Verified by: `src/__tests__/test-policy.test.ts` > "no first-party module is replaced by vi.mock"

### The mutation-probe corpus

What a lint cannot check is whether a test that *can* fail *would* fail for the
right reason. That is what `probes/corpus.json` is for: a committed corpus of
surgical edits, each one a defect shape this repo has already been bitten by.

```sh
node scripts/run-probes.mjs --check            # anchors still apply (seconds)
node scripts/run-probes.mjs                    # full run, ~15 min
node scripts/run-probes.mjs --tag=security     # the security subset
node scripts/run-probes.mjs --only=<id>,<id>   # one probe, for item 7 above
```

Each probe is applied, the whole suite runs, and the file is restored. A
**survivor is always news**: it names a property nothing in the suite defends.
This is deliberately not Stryker — Stryker generates thousands of mutants, most
of them equivalent, and takes hours; this corpus runs in minutes and every
mutant in it is real, so the score means something.

Two rules keep it honest, both enforced by `test-policy.test.ts`: every probe's
anchor must still apply (a rotted anchor silently stops being a mutant and the
score climbs for free), and **no probe may be a no-op** — the corpus this file
inherited had five entries whose `find` equalled their `replace`, permanently
uncatchable and permanently dragging the measured rate down.

**Every probe written during a bug investigation gets committed here.** That is
the mechanism that makes an audit compound instead of expire.

## The expression allowlist

`src/expr/` is the HTML Runtime's expression language. It is an **allowlist by
construction**, and it stays one under a single review rule:

> **Any request to support X is answered by adding X to a table in
> `src/expr/allowlist.ts`, never by widening dispatch. If X cannot be expressed
> as a table entry, the answer is no.**

This is not stylistic. The design it replaced was a blocklist of nine names over
a full JavaScript evaluator, and it lost — `items[k]` with `k` from server JSON
reached the `Function` constructor without the blocked name ever appearing in
the source text. A table lookup has no equivalent hole, because `"constructor"`
is not a key in any table.

Three mechanisms hold the line, and all three are CI failures rather than review
conventions:

1. **`allowlist-snapshot.test.ts` pins the exact sorted list of every name the
   language grants.** Widening any table fails the suite until the snapshot is
   updated in the same change — which puts every capability grant in front of a
   reviewer as a diff of a file whose only job is to say what this language can
   reach. If the snapshot feels annoying, it is working.
2. **`no-escape-hatch.test.ts` reads the source of `src/expr/**`** and rejects
   `new Function`, `eval(`, `import(`, `globalThis`, `window`, `document`,
   `setTimeout`, the identifier `constructor` outside the deny list, any `class`
   body, any swallowing `catch`, and — the rule that carries the security model —
   any computed member read `recv[key]` outside the two audited helpers.
3. **The AST is a closed discriminated union.** A new node kind without both a
   validator case and an interpreter case does not compile.

If you are adding a method, a property or a global: add the row, run the
snapshot test, and put the new name in the PR description. If you are adding a
node kind or a call form, say in the PR why the existing tables could not
express it.

Verified by: `src/expr/__tests__/allowlist-snapshot.test.ts` > "the allowlist is exactly this set of names"
Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "src/expr contains no path to the Function constructor or a global"

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
