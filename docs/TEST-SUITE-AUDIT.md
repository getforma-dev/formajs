# Test-suite audit and remediation plan — 2026-08-05

> **STATUS — the plan in §4 has been executed.** What the remediation lane
> actually did, and what it measured, is recorded in §6 at the bottom of this
> file. The standard it produced is `CONTRIBUTING.md` §
> "Writing a test that can fail"; the mechanism that keeps it true is
> `probes/corpus.json` + `scripts/run-probes.mjs`. Read §1–§5 for the reasoning
> and the evidence; read §6 for what is now true.
>
> **What this is:** a point-in-time audit of this repo's test suite (and the
> compiler's), the evidence behind it, and the remediation plan it produced.
> It is a record, not a standard.
>
> **The standard lives elsewhere.** The eight rules and the `Verified by:`
> citation contract in §2–§3 have been promoted to the stack-wide policy at
> [`forma/docs/TESTING.md`](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md),
> which is what a reviewer applies. Read that one to write a test; read this
> one to understand why each rule exists and what it cost us.
>
> **Line numbers and counts are as of the commits named below and are stale by
> construction.** Test *names* are the durable citation and are used
> throughout; that is deliberate.

**Scope:** `formajs` @ `17f8783` (1007 vitest tests / 102 files, plus 33 Playwright tests that `npm test` does not run) and `forma-tools/packages/compiler` @ `53f3f9d` (239 tests / 9 files).
**Evidence base:** 42 hand-rolled mutation probes + a full Stryker run on formajs; 32 binary probes on the compiler, replayed through the real Rust FMIR consumer; a defect-by-defect retrospective on all 41 findings in `docs/HARDENING-AUDIT.md`; a static taxonomy sweep of all 1003 parsed test bodies.
**Line numbers are as of those commits.** The tree has moved since (`hydrate.test.ts` has grown); test *names* are the durable citation and are used throughout.

---

## 1. The honest bottom line

**The suite detects 69% of injected defects (74% after excluding three probes verified behaviourally equivalent) — but only 43% on security-relevant code and 17% on the SSR renderer, which is the one component whose output goes straight into a browser.** Of the 1007 tests, roughly **400 carry real regression-detection value**; about **41 are provably incapable of failing** (they pass with the feature they name deleted from production code — `runtime-blocklist.test.ts` and `runtime-parsestate.test.ts` are entirely in this class, 18 tests between them, both files named for security controls), and roughly another **140** assert a spy count, a thrown error, or markup shape without ever checking the user-visible consequence.

**The single most expensive habit is testing each construct alone, on one path, and never in combination or on the parallel path.** FormaJS has four renderers that must uphold the same guarantees (SSR `render.ts`, client `h()`/`element.ts`, hydration adoption `hydrate.ts`, and the HTML runtime's `data-*` binder). Every guarantee is tested thoroughly on exactly one of them. That habit alone let through 7 of the 25 real code defects (28%) including the only non-documentation Critical (`client-url-attr-xss-h`: `h('a', {href:'javascript:alert(1)'})` emits the attribute verbatim, while `ssr-integration.test.ts` "blocks javascript: URI in href" has guarded the SSR path since day one). The same shape is live in the compiler right now: slot-name uniqueness is asserted only inside the `list:`/`show:` describes, so a page with two dynamic attributes of the same key still mints duplicate slot names and the real Rust consumer reports `CONTRACT_FAIL dup_slot_names=1` while all 239 tests stay green.

**The owner's instinct that the tests feel like overhead is correct, and the fix is not "write more tests."** It is: delete ~71 that prove nothing, rewrite ~150 from mechanism to property, and add ~95 new declarations concentrated on the guarantees the probes proved are undefended. Two entire files (`runtime-blocklist.test.ts`, `ir-walk-snapshots.test.ts`) and two self-skipping compiler tests should be deleted outright today; that is 22 tests, 30 minutes of work, and zero loss of coverage because they never covered anything.

---

## 2. The policy

Eight rules. Every one is derived from a defect this suite actually shipped — no generic advice. Each has a BAD example taken verbatim from these repos and a GOOD one, most of them also from these repos.

### P1 — Assert the guarantee, not the mechanism

A spy count, a throw, or a markup shape is evidence *about* the implementation. The guarantee is what the user observes. Pin the observation; the mechanism is free to change.

**Cost:** 148 tests assert only `toHaveBeenCalled*` or `toThrow`. Probe `switch/no-scoop-back` (delete the loop that scoops rendered nodes back into a cached fragment, so the third visit to a branch renders *nothing*) **survived all 1007 tests** — the cache test watches a counter and never re-reads the DOM.

```ts
// BAD — src/dom/__tests__/switch.test.ts, "caches previously rendered branches"
setTab('b');
setTab('a');                 // switch back — should reuse cached node
expect(renderCount).toBe(1); // still 1, not re-rendered
// The cache can return an EMPTY branch and this still passes.

// GOOD — same file, "renders matching branch" (already correct; copy this shape)
expect(getContent(container)).toBe('Home');
setTab('about');   expect(getContent(container)).toBe('About');
setTab('contact'); expect(getContent(container)).toBe('Contact');

// GOOD — the repo's best example, src/__tests__/runtime-hardening.test.ts
// mountWithBlockedHandler(): the blocked handler did NOT run AND the page
// survived — a sibling directive on the same scope still binds.
expect(() => { mount(offscreen); }).not.toThrow();
expect(offscreen.querySelector('#out')?.textContent).toBe('0'); // before click
btn.click();
expect(offscreen.querySelector('#out')?.textContent).toBe('0'); // and after
```

The `not.toThrow()` in that GOOD example is fine *because it is followed by the observable outcome*. A bare `not.toThrow()` is not a test.

**Rule:** every `toHaveBeenCalled*` / `toThrow` / `not.toThrow` must be followed, in the same test, by an assertion on rendered output, returned value, or observable state.

### P2 — Test constructs in COMBINATION, not just isolation

This is the rule that would have prevented the most bugs. Two constructs that are individually correct can be jointly wrong, and the same guarantee asserted on one path is not asserted on its sibling path.

**Cost:** 7 of 25 code defects, including the only non-doc Critical. Plus the live compiler bug CT-01.

```ts
// BAD — the guarantee exists on one sink only.
// src/__tests__/ssr-integration.test.ts asserts it:
it('blocks javascript: URI in href', () => {
  const html = renderToString(sh('a', { href: 'javascript:alert(1)' }, 'click'));
  expect(html).not.toContain('javascript:');
});
// src/dom/__tests__/element.test.ts has 60 tests on h() and never passes a URL
// scheme through href/src/action/poster. Probe: h('a',{href:'javascript:alert(1)'})
// -> getAttribute('href') === 'javascript:alert(1)'. Green suite, live XSS.

// GOOD — one vector table, run against ALL sinks:
describe.each([
  ['ssr',      (p) => renderToString(sh('a', p))],
  ['h',        (p) => h('a', p).outerHTML],
  ['adopt',    (p) => adoptAndSerialize('a', p)],
  ['data-bind',(p) => mountBindAndSerialize('a', p)],
])('url scheme guard: %s', (_name, render) => {
  it.each(DANGEROUS_URLS)('%s is not emitted', (url) => {
    expect(render({ href: url, id: 'ok' })).not.toMatch(/script:/i);
    expect(render({ href: url, id: 'ok' })).toContain('id="ok"'); // see P3
  });
});
```

The compiler version of the same rule:

```ts
// BAD — packages/compiler/tests/ir-walk.test.ts
// The only 4 uniqueness assertions live inside the createList / createShow
// describes, and every fixture there uses list:/show: slots:
expect(new Set(slotNames).size).toBe(slotNames.length);
// A page combining two dynamic attrs of the same key -> [attr:id, attr:id]. DUP.

// GOOD — fold it into the shared walkAndEmit()/walkCallAndEmit() helpers so all
// 84 tests enforce it for free, and add combination fixtures:
//   h('div',{id:()=>a()}, h('span',{id:()=>b()},'x'))
//   h('div',null,h('span',null,()=>a()),h('span',null,()=>b()))
//   createList(...) + a page-level dynamic attr
```

**Rule:** when N code paths must uphold the same guarantee, the assertion lives in **one shared table** parameterised over the paths — never copied into one path's file. When a new sink/renderer/branch is added, it joins the table or the PR is rejected. Fixtures must combine at least two constructs (list + dyn attr, island + island, show + text) before a feature is called covered.

### P3 — Two-sided assertions: absence AND presence

`not.toContain('javascript:')` is satisfied by a renderer that emits no attributes at all.

**Cost:** probe P31 (`renderToBufferHydrated` drops *every* prop) survived all 1007 tests, including all four "blocks …" tests.

```ts
// BAD — src/__tests__/ssr-integration.test.ts
const html = renderToString(sh('img', { src: 'javascript:alert(1)' }));
expect(html).not.toContain('javascript:');

// GOOD
expect(renderToString(sh('a', { href: 'javascript:alert(1)', id: 'ok', title: 'safe' })))
  .toBe('<a id="ok" title="safe">…</a>');   // dangerous gone AND benign intact
```

**Rule:** every "we block X" test renders X *alongside* a benign sibling and asserts both halves. Prefer exact-output `toBe` over fragment `toContain` for anything that produces markup — `render.ts` currently has 148 surviving Stryker mutants (44.21%, worst file in the repo) almost entirely because its assertions are `toContain` fragments.

### P4 — Depth floors

A single transition cannot observe a cache that poisons on the second, and a 3-item list cannot reach a 32-item algorithm.

**Cost:** 691 of 1003 tests (68.9%) drive zero state transitions; only 42 (4.2%) drive three or more. Lines 408–462 of `src/dom/list.ts` — the entire LIS keyed-move algorithm, the performance core of a "no virtual DOM" library — **execute zero times in the whole suite**; four separate mutations of it survive. `show-adoption` cache poisoning is invisible at one toggle and obvious at two.

Floors, non-negotiable for new tests:
- **State machines** (show / switch / portal / hydrate branches): **N ≥ 3 transitions**, asserting the invariant *after every transition*, not just the last.
- **Lists**: at least one fixture **≥ 2 items** for every behaviour, and at least one **≥ 40 items** per algorithm branch (`SMALL_LIST_THRESHOLD` is 32 — both sides get exercised, ideally by parameterising the threshold).
- **Islands**: **≥ 2 instances** on the page, because cross-island isolation (`throwing-binding-aborts-flush-cross-island`, `islands-script-parse-not-isolated`) is invisible with one.
- **Recursive parsers/strippers**: at least one fixture at **depth ≥ 10 000** — `deepStripForbidden` is tested at depth 2 and throws `RangeError` out of `handleRPC` at 30 000.
- **Branch fixtures must be distinguishable.** A ternary whose branches encode to the same byte length cannot detect a swap of the two length fields (compiler probe P30 survives every test and the byte-exact snapshot); a show whose branches both render the text "Truthy" cannot detect a mislabelled cached fragment.

```ts
// BAD — src/dom/__tests__/hydrate.test.ts, "forward mismatch: SSR content stays until signals correct it"
setShow(true);
expect(root.textContent).toBe('Truthy');
// Both branches render 'Truthy'. A correct run and a poisoned run are identical.
// The test's own comment then rationalises the defect as intended behaviour.

// GOOD
for (let i = 0; i < 4; i++) {
  setShow(i % 2 === 0);
  expect(root.querySelector('p')?.dataset.origin)
    .toBe(show() ? 'client-true' : 'client-false'); // invariant after EVERY toggle
}
```

### P5 — Adversarial input is mandatory for anything parsing untrusted data

If a function accepts JSON, a URL, an attribute value, an HTML string, or an RPC body, its test file **must** include hostile fixtures. "Happy path plus a malformed string" is not adversarial.

**Cost:** `store-proto-hijack-via-setter` (`setState(JSON.parse('{"__proto__":{"isAdmin":true}}'))` forges `state.isAdmin === true`); `mutate/setText-uses-innerHTML` turns a function documented "safe for user-controlled strings" into an XSS sink and survives on a file with **100% line coverage**; `escapeHtml` has no text-child test at all, so deleting `.replace(/</g,'&lt;')` ships a live `<script>` and 1007/1007 stay green.

```ts
// BAD — src/state/__tests__/store-adversarial-fixes.test.ts is NAMED adversarial
// and contains six tests about same-raw reassignment and array-method reads.
// No hostile key anywhere. grep '__proto__' in src/state/__tests__ -> persist.test.ts only.

// GOOD — the instinct already exists in the repo, applied to the wrong path:
// src/state/__tests__/store.test.ts, "deepClone handles circular references
// without stack overflow". Apply the same instinct to the SETTER:
for (const key of ['__proto__', 'constructor', 'prototype']) {
  setState(JSON.parse(`{"${key}":{"isAdmin":true}}`)); // JSON.parse is load-bearing
  expect((state as any).isAdmin).toBeUndefined();
  expect(Object.getPrototypeOf(state)).toBe(before);
  expect(({} as any).isAdmin).toBeUndefined();
}
```

Corollary — **negative space counts too.** Every blocklist needs an allow-list test. `DANGEROUS_SCHEME_RE` is anchored with `^`; removing the anchor makes it a substring match and no test notices, because every `isDangerousUrl` case feeds a URL that *should* be blocked. `https://example.com/guides/javascript` must be asserted to pass.

Corollary — **allowlists are tested for completeness, not contents.** `URL_ATTRS` has seven entries; only `href` and `src` are exercised. Deleting `'action'`, `'poster'` or `'background'` is invisible. Use `describe.each(URL_ATTRS)`, not hand-picked members.

### P6 — A test must be able to fail

If deleting the feature does not turn the test red, it is not a test. It is documentation with a green checkmark, and it is worse than nothing because it buys false confidence in a security control.

**Cost:** `src/__tests__/runtime-blocklist.test.ts` (10 tests) and `src/__tests__/runtime-parsestate.test.ts` (8 tests) are both entirely in this class, and both are named for hardening controls that `SECURITY.md` cites.

```ts
// BAD — src/__tests__/runtime-blocklist.test.ts imports NOTHING from production.
// Its header admits it: "Since findBlockedMethod is a private function inside
// runtime.ts, we test its behavior via ... simulate what extractBracketContents does."
function simulateConcatDetection(expr: string): string | null {
  const UNSAFE = new Set(['constructor', '__proto__', 'prototype', /* … */]);
  /* 35 lines re-implementing findBlockedMethod */
}
// PROVED: `if (1 as number) return null;` at the top of findBlockedMethod
// (src/runtime.ts:658) -> runtime-blocklist.test.ts 10/10 PASS,
// runtime-hardening.test.ts 4/7 FAIL ("x.Function is not a function" — the
// payload reached new Function).

// BAD — src/__tests__/runtime-parsestate.test.ts. All 8 tests, verbatim:
it('strips __proto__ from parsed state', () => {
  const el = mountState('{"__proto__": {"polluted": true}, "safe": 1}');
  expect(el).toBeTruthy();   // <- querySelector finds the markup the helper just wrote
});
// parseState is never called. activateIslands is imported on line 8 and never
// invoked. PROVED: making parseState throw unconditionally -> 8/8 still pass.

// GOOD
mountState('{"__proto__":{"polluted":true},"safe":1}');
activateIslands();
expect(({} as any).polluted).toBeUndefined();
expect(Object.prototype).not.toHaveProperty('polluted');
expect(scopeOf(el).safe).toBe(1);       // the safe key survived the strip
```

Two more shapes that cannot fail and must be treated the same:
- **No `expect()` at all.** Three tests in `hydrate.test.ts` ("skips static string children", "skips falsy children (false, null, undefined)", "falls back to text when function child returns primitive with element at cursor") call `adoptNode(...)` under a `// Should not throw` comment and assert nothing. The last one even *states the expected outcome in a trailing comment* and does not assert it.
- **Assertions that are true by construction.** Six tests in `index-surface.test.ts` (`does NOT export HTTP primitives`, `… storage`, `… server`, `… longestIncreasingSubsequence`, `… createValueSignal`, `… WASM helpers`) assert `toBeUndefined()` on names never exported. They pass with any typo and can only fail if someone *adds* the export. Meanwhile silently dropping `createPortal` from `src/index.ts` is not caught. `expect(Object.keys(forma).sort()).toEqual(EXPECTED)` catches both directions in one assertion.
- **Reading a mock's own configuration back.** `src/wasm/__tests__/forma-wasm.test.ts` mocks a module (`'forma-test-loader'`) that does not exist in the repo, stubs `fetch`, then asserts `expect(out).toBe('<div>ok</div>')` — the literal string its own `renderSpy` was told to return.

### P7 — No self-skipping tests, ever

A test that returns early and reports green is a lie told once per CI run.

**Cost:** the two tests carrying the **only** end-to-end assertions on a real compiler-emitted binary — `ir-roundtrip.test.ts` "real compiler-emitted onboarding IR has valid v2 format" and "all 7 page IR files have valid FMIR v2 headers" — resolve their fixture to `C:\auth-module-poc\admin\dist\…`, five levels up and outside the repo. It does not exist. 28 `expect()` calls (53% of that file's assertions) have never executed, and CI is green.

```ts
// BAD — packages/compiler/tests/ir-roundtrip.test.ts
if (!fs.existsSync(irPath)) {
  console.warn('Skipping: run `npx tsx build.ts --ssr` in admin/ first');
  return;                      // reports PASSED
}

// GOOD — either the fixture is in-repo and unconditional…
const bin = walkHTree(loadFixture('ternary-asymmetric.tsx'));
// …or absence is a hard failure:
expect(fs.existsSync(irPath)).toBe(true);
```

**Rule:** no `existsSync` guard, no `it.skip`, no environment sniffing that returns early. Fixtures live in the repo. If a check genuinely needs a build artifact, it is a separate CI job that fails loudly when the artifact is missing.

### P8 — Mock almost nothing; never mock the thing under test

**What is legitimate to mock:** browser APIs that happy-dom does not implement (`ResizeObserver`, `IntersectionObserver`), the network boundary (`fetch`), the clock, and cross-process boundaries. And even then, assert the *effect*, not the mock's arguments.

**Never mock:** the module under test, the parser under test, the escaper under test, the loader under test. If a function is private and that pushes you toward simulating it, **export it** — `findBlockedMethod` and `generatePlaceholderIr` are both private, and both got a fake test as a result.

**Cost:** `forma-wasm.test.ts` (asserts its own mock's return value); compiler `ir-roundtrip.test.ts` "placeholder IR from SSR plugin has valid structure" re-implements `generatePlaceholderIr` line-for-line inside the test body — replacing the real function with `return new Uint8Array(0)` (a zero-byte, unparseable `.ir` file, the fallback every page uses when real emission fails) leaves 239/239 green.

```ts
// BAD — activate-visible.test.ts, "creates IntersectionObserver with 200px rootMargin"
expect(FakeIO).toHaveBeenCalledWith(expect.anything(), { rootMargin: '200px' });

// GOOD — same fake, real guarantee
fakeObserver.fire([{ isIntersecting: true, target: islandEl }]);
expect(islandEl.dataset.formaStatus).toBe('active');
expect(islandEl.textContent).toBe('hydrated content');
```

Corollary — **test the shipped configuration.** All 1007 tests run a fourth, unshipped build variant: `tsup.config.ts` has five `__FORMA_UNSAFE_EVAL_MODE__` defines, `vitest.config.ts` has none, so `src/runtime.ts:349-354` is skipped entirely under test. Every eval-touching file then calls `setUnsafeEval(false)` in `beforeEach`, normalising away the exact variable the headline security claim is about. That is how a shipped default of **unsafe-eval ENABLED** coexisted with four documents claiming the opposite. Fixtures may not neutralise the value under test; at least one test must observe the boot-time default with no setter called.

---

## 3. The comment-citation contract

The repo is adopting `Verified by: <test path> > "<test name>"` comments on security-relevant code. That convention is load-bearing and therefore dangerous.

**A citation is honest only if the cited test would actually fail when the asserted property breaks.** Nothing else counts. Not "the test is in the right file." Not "the test name matches the property." Not "the line is covered" — `src/dom-utils/mutate.ts` reports 100% statements / 100% branches / 100% functions / 100% lines and its `setText` can be swapped to `innerHTML` with the suite green.

**How we check it — the mutation-probe method (this is the whole contract):**

1. Break the cited property in production code with the smallest possible edit (delete the guard, invert the condition, drop the escape, return early).
2. Run **only the cited test**.
3. It must fail. If it passes, the citation is false and must be deleted or the test fixed — in the same PR.
4. Revert (`git checkout -- <file>`), confirm `git status --short` is empty, confirm the suite is green again.

That loop takes about 90 seconds per citation. It is the same loop that produced every finding in this document, and it is cheap enough to be a review step rather than a project.

**A citation pointing at a test that cannot fail is strictly worse than no citation.** No comment leaves a reader appropriately suspicious. A false comment converts a reviewer's suspicion into confidence and does it at exactly the moment they are deciding whether to look harder. `SECURITY.md:27` currently cites `findBlockedMethod` as a named hardening control; the file that appears to test it (`runtime-blocklist.test.ts`) passes with `findBlockedMethod` deleted. That citation actively cost us — the sandbox-escape gap it was covering for (`with()` + a Proxy `has` trap returning `key in scope.getters`, letting `document` / `fetch` / `localStorage` fall through to global scope) is not modelled anywhere in the suite, and nobody looked, because the box was ticked.

**Additional rules for citations:**
- Cite a test **name**, not a line number. Line numbers rot within a week — the lanes' `hydrate.test.ts` line numbers were already stale at the time of writing.
- One citation, one property. `Verified by: X` on a five-property function is unverifiable by construction.
- If the cited test is a table (`it.each`), cite the table and the row's parameter, e.g. `> "url scheme guard: h > javascript:alert(1) is not emitted"`.
- Comments that assert a defence the code does not provide are the same defect class. `src/dom/show.ts:108` and `src/dom/list.ts:621` wrap rendering in `untrack()` with prominent comments claiming it prevents the parent effect from disposing children — `createRootImpl` already calls `setActiveSub(undefined)`, so the `untrack` is a verified no-op. Either delete it and correct the comment, or keep it and add a `root.test.ts` test that pins `createRoot`'s untracking contract.

---

## 4. The remediation plan

Ordered by **bugs prevented per unit of work.** Phase 1 is a single afternoon and removes every provably-dead test in both repos. Phases 2–4 are the real value. Phase 5 is hygiene.

### Phase 1 — Delete (≈2 hours, removes 71 tests, loses zero coverage)

Deleting tests that prove nothing is a win. Every item below was proved dead by a mutation probe or by reading.

| # | Delete | Tests | Why |
|---|---|---|---|
| D1 | `src/__tests__/runtime-blocklist.test.ts` — whole file | 10 | Imports nothing from production. Blocklist deleted → 10/10 pass. |
| D2 | `src/__tests__/index-surface.test.ts` — the six `does NOT export …` tests | 6 | True by construction; can only fail on addition. |
| D3 | `src/dom/__tests__/hydrate.test.ts` — "skips static string children", "skips falsy children (false, null, undefined)", "falls back to text when function child returns primitive with element at cursor" | 3 | Zero `expect()` calls. |
| D4 | `src/__tests__/runtime-performance.test.ts` — "yields to main loop without throwing" | 1 | `await expect(yieldToMain()).resolves.toBeUndefined()` passes for any void async fn. |
| D5 | `src/wasm/__tests__/forma-wasm.test.ts` — 2 of 3 tests (keep one, rewritten, see R7) | 2 | Assert the mock's configured return value. |
| D6 | `src/__tests__/hydration-observability.test.ts` — 12 of the 20 "matches"/"equivalent structure" tests | 12 | Assert SSR-vs-client markup equality (implementation output); cannot catch any of the 7 adoption defects. |
| D7 | CSP parser triplet (`csp-parser-extensions` 26 + `csp-parser-precedence` 6 + `csp-string-literal` 4) collapsed to `it.each` tables | −25 net | 23-test identical skeleton copy-pasted three times. Inputs keep their coverage as table rows. |
| D8 | `packages/compiler/tests/ir-walk-snapshots.test.ts` + its `.snap` | 10 | 0 unique kills across 32 probes; hex-dumps section 0 only, so slot names, type hints, island tables are invisible. Diffs get blessed with `-u`. |
| D9 | `packages/compiler/tests/ir-roundtrip.test.ts` — "real compiler-emitted onboarding IR has valid v2 format", "all 7 page IR files have valid FMIR v2 headers" | 2 | Self-skip on a path outside the repo; 28 assertions have never run. Assertions move to A14. |

Also delete, in production code: `DANGEROUS_URI_ATTRS` / `DANGEROUS_URI_RE` (`src/ssr/render.ts:40-41`) — unreferenced anywhere in either repo, contributing 12 permanently unkillable mutants that depress the worst-scoring file's score and mask real gaps in the same report.

### Phase 2 — The three Criticals (≈1 day, highest value in the plan)

| # | Work | Detail |
|---|---|---|
| A1 | **`src/__tests__/eval-default.test.ts`** (new) | `vi.resetModules()` + dynamic import, **no setter called**. Mount a container with `data-computed="items.filter(i => i > 1)"` (an arrow the CSP parser rejects, so it can only resolve through `new Function`). Assert the computed did not resolve and a diagnostic was recorded. Assert `getUnsafeEvalMode()` before any mutation. Mirror for the hardened entry. Pins `csp-safe-by-default-is-false`. |
| A2 | **Shared URL-scheme table** (new, replaces the per-sink tests) | 6 vectors × 7 attrs (`href`, `src`, `action`, `formaction`, `poster`, `background`, `xlink:href`) × 4 sinks (`renderToString`, `h()`, `adoptNode`, `data-bind:*`). Each cell: dangerous value absent **and** benign sibling attribute present. Kills `client-url-attr-xss-h`, `url-attrs-missing-object-data`, P29, P31, and 3 Stryker survivors in `url-safety.ts`. |
| A3 | **Escaping tables** (new) | `escapeHtml` has **no test**. Exact-output table over all five characters (`& < > " '`) × both escapers × both renderers, including the attribute-breakout case `sh('a',{title:'" onmouseover=x "'})` → `title="&quot; onmouseover=x &quot;"`. Kills probes P07, P28, P04 and all 5 surviving StringLiteral mutants on `render.ts:17-21`. |
| R1 | **Rewrite `src/__tests__/runtime-parsestate.test.ts`** (8 tests) | Export `parseState` or drive it through `activateIslands()`. Assert `Object.prototype.polluted === undefined`, the surviving safe key renders, `'prototype'` is covered (currently untested even by name), and the URL-with-colon value reads back verbatim. Drop the unused `activateIslands` import. |
| A4 | **Sandbox-escape tests** (new — the assertion `SECURITY.md:27` claims exists) | With unsafe-eval enabled, mount `data-on:click="{ document.title = 'pwned' }"` and assert `document.title` unchanged; repeat for `fetch`, `localStorage`, `XMLHttpRequest`. Plus the real blocklist vectors (`'constr'+'uctor'`, `'ev'+'al'`, three-fragment splits) driven through `mount()` using `mountWithBlockedHandler`'s shape. Replaces D1. |
| A5 | **Compiler: slot-name uniqueness in the shared helper** | Fold `expect(new Set(names).size).toBe(names.length)` into `walkAndEmit` / `walkCallAndEmit` so all 84 tests enforce it. Add the four combination fixtures. **These will fail today** — that is the point; `attr:<key>` and `text:<childIndex>` need the same `#N` occurrence registry that `list:`/`show:` got. |

### Phase 3 — Depth and sibling-path parity (≈2 days)

| # | Work | Detail |
|---|---|---|
| A6 | **Keyed reconciliation at n = 40 / 200** | The LIS branch (`list.ts:408-462`) has never executed. Shuffle, reverse, remove-middle, insert-at-head, duplicate keys, repeated-key-with-move. Assert final key order equals the model, node identity preserved for surviving keys, `insertBefore` count ≤ n − |LIS|. Parameterise `SMALL_LIST_THRESHOLD` so both branches run the same table. Kills 4 surviving mutants including duplicate-key collapse — the exact regression the source comment claims was fixed. |
| A7 | **show / switch / portal: ≥3 transitions with DocumentFragment branches** | No test in any of the three ever uses a fragment branch, and the fragment-handling code both files spend 15 lines of comments justifying is never reached. No portal test ever re-renders. Kills `show/no-fragment-sweep`, `switch/no-scoop-back`, `portal/no-remove-prev`. Three ready-made probe tests already exist from the taxonomy lane. |
| A8 | **Hydration-adoption parity suite** | Re-run the CSR guarantees on the adoption path: row-effect disposal (`list-disposal.test.ts` "item effects are disposed when item is removed from list" has no adoption twin), `ref` props (`grep ref` in `hydrate.test.ts` = 0 hits), `className` vs `classname` drift, duplicate `forma-key` ghost rows, show-branch list descriptors. Fixtures must be **compiler-emitted, not hand-built** — `hydrate.test.ts` hand-builds empty island regions (`<!--f:i0--><!--/f:i0-->`) the compiler never emits, which is precisely why `island-shell-adoption-drift` was invisible. |
| R2 | **Rewrite the show forward/reverse mismatch tests** | 4-toggle loop with `data-origin`-distinguishable branches, invariant asserted after every toggle. Delete the comment declaring the mismatch out of scope. |
| A9 | **RPC depth + unhandled rejection** | Build 30 000-level nesting in a loop; assert `handleRPC` **resolves** to a 4xx rather than throwing `RangeError`. Parameterise the existing depth-2 pollution test over `[1, 2, 64, 30000]`. Replace `mockRes()` with a real `process.on('unhandledRejection')` listener for the middleware twin. |
| A10 | **Store: hostile keys through the setter and the proxy** | `['__proto__','constructor','prototype']` × `setState(JSON.parse(…))` and direct proxy assignment. Three assertions each (no forged field, prototype unchanged, `Object.prototype` intact). |
| A11 | **Store array aliasing** | Alias `const items = state.items` **before** the effect, read `items[i]` inside; push/splice/sort/`length=n`. Current tests read inline and incidentally subscribe to the array-version signal, which is why deleting `reconcileChildren` is invisible. Add a nested path (`items[0].done`) and a truncation case. |
| R3 | **Compiler: `parseOpcodeList` returns `{op, operands}`** | One helper change upgrades all 84 opcode assertions from payload-blind to payload-checked. Assert `DYN_ATTR.slot_id` matches the slot table, `DYN_TEXT.marker_id`s are pairwise distinct, `SHOW_IF.then_len/else_len` equal the measured byte spans, `OPEN_TAG` attr pairs decode as (key, value). Kills P24, P29, P30, P21, P22 — five mutations that corrupt operands while leaving opcode shape identical. |
| A12 | **Compiler: structurally asymmetric ternary fixtures** | Branches differing in opcode count, not text, so `then_len !== else_len` and a swap is detectable. Today every SHOW_IF fixture in the suite encodes to equal-length branches — even the byte-exact snapshot cannot see the swap. |

### Phase 4 — Undefended guarantees with no test at all (≈2 days)

| # | Work |
|---|---|
| A13 | `src/server/mutation.ts` — **5.88% statements, no test file exists.** `registerResource`, `unregisterResource`, `applyRevalidation`, `enableAutoRevalidation`, `withRevalidation` are all public on `@getforma/core/server`. ~8 tests: real `createResource`, dispatch `forma:revalidate`, assert `data()` reflects the payload, unregister stops it, cleanup detaches, `withRevalidation` single-flights. |
| A14 | **In-repo compiler fixture corpus + FMIR header/opcode assertions** (absorbs the deleted D9 assertions): committed `.tsx` pages covering static / dyn attrs / dyn text / asymmetric ternary / `createShow` / `createList` ×2-same-source / island + nested island / **non-ASCII + emoji**. The last one matters: probe P14 (string length prefix counting UTF-16 units, not UTF-8 bytes) produces `PARSE_FAIL BufferTooShort { expected: 25748, actual: 83 }` in the Rust parser, and the JS suite has no non-ASCII fixture at all. |
| A15 | `createEffect` error path — `catch` block at `effect.ts:204-210` and the `reportError` paths in `runCleanup`/`runCleanups` are **NoCoverage**. Body throws after `onCleanup()` → error reported once, cleanup still runs on re-run and dispose. Throwing cleanup → remaining cleanups still run. Both single-cleanup and promoted-bag shapes. |
| A16 | Cleanup-array pool (`effect.ts:28-65`) — 13 surviving mutants including `poolIdx++` → `poolIdx--` and pooling disabled entirely. Create/dispose >32 effects interleaved with distinguishable cleanups; assert every cleanup fires exactly once and no effect observes another's. |
| A17 | `activate.ts:82` re-activation guard — `it.each(['active','hydrating','disposed','error'])` asserting hydrate was NOT invoked, plus the positive counterpart (`pending` and absent DO activate). Three of the four statuses are currently unpinned. |
| A18 | `onResize` / `onIntersect` in `src/dom-utils/observe.ts` — both bodies uncovered, "validated by analogy" in a comment. Reuse the fake-observer helper `activate-visible.test.ts` already has. |
| A19 | `initRuntime`, `destroyRuntime`, `setDebug`, `setDiagnostics`, `getScopes`, `setScopeValue`, `resetScope` — 7 public exports of `@getforma/core/runtime` with **zero mentions in any test**. Minimum: init→mount→destroy round-trip asserting listeners and the MutationObserver are gone; `setScopeValue` driving a re-render; `resetScope` restoring parsed state. |
| A20 | `setText` / `setHTMLUnsafe` adversarial pair; CSP style claims (`cssText` setter spied and asserted never invoked; `parseCssString` kebab→camel round-trip; all four documented style forms produce identical computed values). |
| A21 | `url-safety` negative space — `https://example.com/guides/javascript`, `?q=vbscript`, `data:image/png;base64,…`, `/relative/javascript-guide` all → `false`. Pins the `^` anchor. |

### Phase 5 — Structural gaps (≈1 day, mostly CI plumbing)

| # | Work |
|---|---|
| A22 | **Tests that import built artifacts.** No test in 1007 imports from `dist/` or by package name — every packaging finding (8 of 41) is unreachable by construction. Add a post-build node script: hardened bundles contain zero `new Function(`; the standard bundle's default `_allowUnsafeEval` matches the documented claim; subpath types resolve under `node10`; the size gate counts chunks. |
| A23 | **Executable doc examples.** 8 of 41 defects are doc-only, including a README example that throws — while `history.test.ts` encodes the *correct* `createHistory` signature 600 lines away. Extract fenced ts/tsx blocks from README/CSP/SECURITY and type-check + run them in CI. |
| R4 | Rewrite `index-surface.test.ts` to one `Object.keys(forma).sort()` snapshot per subpath (7 subpaths, 125 value exports). |
| R5 | Rewrite the ~117 mechanism-only tests in place: append the observable outcome after every spy/throw assertion. This is mechanical, parallelisable, and can be done file-by-file behind the P1 lint rule below. |

### Net test-count change

Counting **hand-written test declarations** (an `it.each` table is one declaration, many cases):

| | formajs | compiler | total |
|---|---|---|---|
| Today | 1007 | 239 | **1246** |
| Deleted | −59 | −12 | **−71** |
| Rewritten in place | ~148 | ~2 | ~150 (no count change) |
| Added | +82 | +13 | **+95** |
| After | ~1030 | ~240 | **~1270** |

So the declaration count is roughly flat (+2%) — but **the count that matters roughly doubles**: tests that can actually fail go from ~400 to ~800, provably-dead tests go from 41 to 0, and expanded executed cases rise to ~1500 because the value now lives in tables rather than copy-paste. **Phase 1 alone takes the number DOWN by 71 before any new test lands**, and that is the correct first commit: it makes the suite smaller, faster, and more honest in one step.

Targets to hold the work to: **overall mutation detection ≥ 85%** (from 69%), **security-relevant paths ≥ 95%** (from 43%), **`src/ssr/render.ts` ≥ 80%** (from 44.21%).

---

## 5. Enforcement

### CONTRIBUTING.md — the reviewer's checklist

Eight lines, phrased as blocking questions:

1. Does every `toHaveBeenCalled*` / `toThrow` in this diff have an observable-outcome assertion after it?
2. Does this guarantee exist on a sibling path (SSR / `h()` / hydrate / `data-bind`)? If yes, is the assertion in the **shared table** rather than one path's file?
3. Does the "we block X" test also assert a benign sibling survives?
4. State machine → ≥3 transitions? List → ≥2 items and a ≥40-item case? Islands → ≥2 instances? Recursive parser → a ≥10 000-depth case?
5. Are the fixture's branches/values **distinguishable** — could a swap of two things pass?
6. Does this parse untrusted input? If so, where are the hostile keys, the allow-list (negative-space) cases, and the completeness test over the allowlist?
7. **Did you break the feature and watch this test go red?** State the mutation you applied in the PR description. One line: `Probe: deleted the isDangerousUrl call in renderAttr → 5 tests failed.`
8. Any `existsSync` guard, `it.skip`, or test with no `expect()`? Any new `vi.mock` of a first-party module? Justify or remove.

Plus the citation rule from §3: **a `Verified by:` comment requires the probe from item 7 against that specific test, or it does not go in.**

### CI — cheap recurring checks (run every PR)

These are lint-grade and take seconds. They would have caught most of §4's dead weight the day it was written:

1. **No-assertion lint.** Fail any `it()` body containing zero `expect(`. Catches 3 tests today, and every future one.
2. **Self-skip lint.** Fail on `existsSync(...) { … return }`, `it.skip`, `describe.skip`, and early `return` inside a test body. Catches 2 today.
3. **Production-import lint.** Fail any file under `__tests__/` whose only imports are `vitest` (i.e. it tests nothing). Catches `runtime-blocklist.test.ts` today — the single highest-value five-line rule in this document.
4. **Tautology lint.** Fail a test file where >70% of `expect()` calls share an identical assertion expression. Catches `runtime-parsestate.test.ts` (8/8 `expect(el).toBeTruthy()`).
5. **Coverage floors per file, not per repo.** `src/server/mutation.ts` at 5.88% and `src/dom-utils/observe.ts` at 29.41% are invisible in a repo-wide number.

### CI — mutation testing

**Yes, add it — but scoped, not repo-wide.** Stryker *does* run here; the caveat is that `npx --yes @stryker-mutator/core` fails with `ERR_MODULE_NOT_FOUND` (typescript resolved from the npx cache rather than the project). The fix is a real devDependency: `npm i -D @stryker-mutator/core@9 @stryker-mutator/vitest-runner@9`. A full run is too slow for per-PR CI.

Recommended configuration:

- **Per-PR:** an **incremental, diff-scoped** Stryker run (`--incremental`, `mutate` limited to files changed in the PR). Threshold: **break at 80%** for changed files, **95% for anything under `src/security/`, `src/ssr/`, `src/server/`, and the eval paths in `src/runtime.ts`**. Minutes, not hours.
- **Nightly / weekly:** full run on `src/`, results published, score tracked over time. Ratchet-only: the score may not go down.
- **Cheaper substitute if the incremental run proves too slow:** keep the **hand-rolled probe corpus** as a committed script. The 42 formajs probes and 32 compiler probes are already written as single surgical edits; encode them as a `probes/*.patch` directory plus a runner that applies each patch, runs the (scoped) suite, asserts it fails, and reverts. It is a mutation-testing harness with a curated mutant list, runs in ~10 minutes for the whole corpus, and — unlike Stryker — every mutant in it is a *real defect shape we actually shipped*, so a survivor is always news. **Every new probe written during a bug investigation gets committed to this corpus.** That is the mechanism that makes the audit compound instead of expiring.
- Suppress known-equivalent mutants explicitly, with a comment naming the proof (the three verified-equivalent survivors: `show`-cache "consumed" nulling, and the two `untrack`-inside-`createRoot` no-ops — the latter two should be resolved by deleting the redundant code per §3).

### CI — the cross-implementation FMIR contract test

The compiler's "roundtrip" tests decode bytes with hand-written readers copy-pasted into four test files. Those readers were written from the same mental model as the emitter, so they agree with it by construction — **including where both are wrong about what `crates/forma-ir/src/parser.rs` actually requires.** The suite pins the compiler's current output, not a contract.

The measurement is unambiguous: over 32 probes, the JS suite killed 22 (68.8%), the Rust lane killed 22 (68.8%), and the **union killed 27 (84.4%)**. Five defects are visible *only* to the Rust lane (list array slot emitted `TYPE_TEXT` not `TYPE_ARRAY`; UTF-16 vs UTF-8 length prefixes; `DYN_TEXT` marker collision; `DYN_ATTR` off-by-one; `SHOW_IF` branch-length swap) and five *only* to the JS lane. They are complementary, not redundant — you need both.

Ship it as three pieces:

1. **`packages/compiler/tests/fixtures/*.tsx`** — the corpus from A14, committed.
2. **`npm run emit:corpus`** — runs the real compiler (`walkHTree`) and writes `.ir` files to a build dir.
3. **`crates/forma-ir/tests/js_emitter_contract.rs`** — for every `.ir`: `IrModule::parse` is `Ok`; slot **names** and slot **ids** are each pairwise unique (this is what `slot.rs:174-179` silently collapses today — duplicates overwrite in `name_to_slot: HashMap<String,u16>` and the earlier slot becomes permanently unreachable for `SlotData` injection); `walk_to_html` succeeds; `walk_island` succeeds for every island entry; and the HTML rendered with **distinguishing per-slot `SlotData`** (each text slot set to a unique `V<name#id>` marker) matches a committed golden.

Wire it so `forma-tools` CI consumes the published `forma-ir` crate (or checks out `forma`), and so a version bump on either side that breaks the other fails **before** either ships. Right now that contract is enforced by nothing at all, and the compiler is emitting duplicate slot names into it today.

---

## 6. What the remediation lane did, and what it measured — 2026-08-06

This section is the outcome. §1–§5 above are the reasoning that produced it and
are left unedited.

### The corpus, and why the numbers differ from §1

The 42 ad-hoc probes of the original audit were consolidated, re-anchored
against the current tree, and committed as **`probes/corpus.json` — 93 probes**,
each one a single surgical edit that breaks a real property. Five entries
inherited from the earlier work had `find === replace`: they were no-ops,
permanently uncatchable, and permanently dragging the measured rate down. They
were deleted, and `src/__tests__/test-policy.test.ts` now fails the build if one
reappears.

Because the corpus changed, §1's "69%" and this section's numbers are not
directly comparable. Both measurements below use **the same 93 probes**, run the
same way — apply, run the whole suite, restore — so the delta is real.

### Before / after

| | probes | before | after |
|---|---|---|---|
| **Overall** | 93 | 58/93 = **62%** | 90/90 = **100%** |
| **Security-relevant** | 43 | 31/43 = **72%** | 43/43 = **100%** |
| **`src/ssr/render.ts`** | 18 | 6/18 = **33%** | 18/18 = **100%** |

Test count over the same window: **1311 → 1699 declarations**. The count is the
less interesting number and was never the target; it is reported because the
plan predicted it could legitimately go *down*, and a lane that improves
detection by deleting tests should be able to say so.

### The three defects the work found

Each one was found by a test that failed before the fix, and each has a
`Verified by:` citation pointing at that test.

1. **`$el.setAttribute()` had no attribute guard at all.** It is the sixth
   attribute sink in the codebase and was the only one with no safety check, so
   a CSP-safe `data-on:click` handler could write the `javascript:` href that
   `data-bind:href` refuses twenty lines away in the same file. Both the name
   and the value come from expressions that can read state, so both halves were
   attacker-reachable. Fixed in `src/expr/interp.ts`.
2. **A non-function `on*` prop was registered as a listener.**
   `h('button', {onclick: 'alert(1)'})` reached `addEventListener` with a
   string. The string never ran; instead the first real click threw
   `listener.call is not a function` inside dispatch and took every other
   listener on that element with it. Fixed in `src/dom/element.ts`.
3. **`data-bind:` wrote `name="true"` for a boolean.** Every other renderer —
   `h()`, adoption, SSR, and the Rust walker — writes a bare attribute, so an
   SSR page and its bound self disagreed byte-for-byte. Fixed in
   `src/runtime.ts`.

All three are sibling-path drift: each guarantee was asserted thoroughly on one
path and nowhere else. None was reachable by any per-file test, which is the
argument for the shared table.

### What was built

- **`src/__tests__/renderer-contract.test.ts`** — the shared table, over all six
  attribute sinks: dangerous URLs (8 vectors × all 8 `URL_ATTRS`), safe-URL
  negative space, event-handler names in four casings, attribute-name breakout,
  boolean semantics, and text escaping. Plus exact-output SSR assertions, which
  is what took `render.ts` off the bottom of the table. A completeness test
  walks `src/` for attribute writers and fails when one appears that is not a
  row.
- **`probes/corpus.json` + `scripts/run-probes.mjs`** — the mechanism that keeps
  this measurable. Anchors are re-checked on every PR (seconds); the full run is
  nightly with a detection floor.
- **`src/__tests__/test-policy.test.ts`** — the lint-grade half of the policy,
  inside `npm test`.
- **CONTRIBUTING.md § "Writing a test that can fail"** — the eight rules and the
  reviewer's checklist, which is what a reviewer actually applies.

### Deliberately not done

- **D7, the CSP-parser triplet collapse.** The three files still share a
  copy-pasted 23-line skeleton, but every test in them already asserts rendered
  output rather than a mechanism. Collapsing them into `it.each` tables is
  maintenance, not detection: it cannot move any number in the table above, and
  it carries real transcription risk. It is worth doing; it was not worth doing
  *first*.
- **D8, D9 and the compiler items (A5, A12, A14).** They live in
  `forma-tools`, which this lane did not touch.
