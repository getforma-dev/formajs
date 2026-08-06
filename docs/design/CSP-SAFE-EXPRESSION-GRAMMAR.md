# Design record — closing the CSP-safe grammar gap

> ## ✅ STATUS: SHIPPED. THIS IS A HISTORICAL RECORD, NOT DOCUMENTATION.
>
> **What this is:** the design record for replacing the HTML runtime's regex
> expression cascade with an allowlist AST interpreter. It was accepted on
> 2026-08-05 and implemented; `src/expr/` exists, the regex cascade and the
> `new Function` fallback are deleted, and every work item in §4 has landed.
> Read it for the reasoning, the rejected alternatives and the exploit chains
> that motivated the design.
>
> **What is true today** is in [`../HTML-RUNTIME.md`](../HTML-RUNTIME.md) (the
> shipped grammar), [`../../SECURITY.md`](../../SECURITY.md) (the security
> model, threat model and residual risks) and [`../../CSP.md`](../../CSP.md)
> (the CSP posture). If any of those and this record disagree, **they** are
> right — a design record describes a decision, not the code.
>
> **Line numbers here are stale by construction.** Every `file:line` reference
> is anchored to commit `17f8783`, before several passes of edits.
>
> **One projection in §1 and §5 was wrong, and it is left uncorrected on
> purpose.** The record predicted **−80 B gzip** versus the bundle users
> download, from a prototype measured at 6.1 KB gzip. The shipped engine is
> ~12 KB gzip, so `formajs-runtime.global.js` grew from 26,194 to 31,755 B
> (+5,561, +21%) and the hardened IIFE from 24,570 to 30,752 (+6,182, +25%).
> The prototype had no positional diagnostics, no DOM-host wrapping for
> `$el`/`$event`/`$refs`, no handler statement grammar and no allowlist
> tables — all four shipped, and all four cost bytes. The §5 "budget +25–40%
> for production polish" hedge under-hedged by roughly a factor of two. The
> §1 gate of 28,000 B was therefore set at 33,000 B against the real
> measurement; see `scripts/check-size.mjs`.
>
> **Other measurements** (competitor comparisons, throughput) were taken on
> 2026-08-05 against the versions named in §5. Re-measure before quoting any
> of them in user-facing material.

**Inputs:** grammar/demand survey, security architecture review, bundle-cost and competitive analysis (all three empirically probed, not estimated).

---

## 1. THE DECISION

**Build the allowlist AST interpreter, ship it as the *only* expression engine in *every* build, and delete the `new Function` fallback entirely.** Not a fast-path in front of the regex parser — a replacement. The grammar we ship is the current grammar *plus* arrow-function callbacks in higher-order-method argument position, expression-statement handlers, `$event`/`$el`/`$refs`/`$dispatch` wired through the interpreter, member and computed assignment in handlers, a real unary tier (`typeof`, `-x`, correctly-precedenced `!`), object literals, general computed member access, and a frozen `SAFE_GLOBALS` table (`Math`, `JSON`, `Object`, `Array`, `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `Date.now`). The line is drawn at **total, side-effect-free, non-escaping expressions**: no loops, no statements inside expressions, no function values that escape a callback slot, no `new`, no dynamic method lookup, no `.call/.apply/.bind`, no path to any global that is not a key in one frozen table. This is not a compromise position — it is the security property. The measured cost is **+1.7 KB gzip over today's hardened build and −80 B versus the bundle users already download** (the interpreter costs 6.1 KB; deleting the regex parser and the eval path gives back 6.1 KB), at **1.15× the eval path's speed**. Budget **+2.1 to +2.7 KB** for production polish and gate the hardened CDN bundle at **28,000 B gzip** — a gate that does not exist today.

**What the front page will be able to claim afterwards, truthfully:**

> The flagship "single HTML file, one script tag" example — including `items.filter(i => i.toLowerCase().includes(query.toLowerCase()))` — runs on the default build under `Content-Security-Policy: script-src 'self'`, with no `unsafe-eval`, no `eval`, and zero `new Function` anywhere in the shipped bytes. **No other library can say this.** Alpine's `@alpinejs/csp` build forbids arrow functions, template literals, spread and *all* globals including `Math`; petite-vue has publicly declared a CSP build not worth building ("it involves shipping an expression parser which defeats the purpose of being lightweight" — we measured that parser at 6.1 KB, net +1.7 KB); Vue's CSP-safe path requires a build step; htmx and Stimulus have no expression language at all. FormaJS's CSP runtime measures **17.5 KB min+gzip — ~9% smaller than `@alpinejs/csp`'s 19.3 KB while supporting strictly more grammar.**

And it will be *provable*: the README markup is extracted from `README.md` by the test suite and mounted, so the shop window cannot silently break again (WI-10, WI-11).

**Why this and not the alternatives:** precompiling attributes with `@getforma/compiler` deletes the sentence "No build tools installed" from the example it is meant to defend, and does nothing for the actual audience (a CMS template, a Rails view, a Shopify theme). A "nonce/hash CSP escape" for eval **does not exist** — nonces and hashes govern `<script>` elements; only `'unsafe-eval'` permits dynamic code. Retiring the example concedes the category. See §6.

---

## 2. THE GRAMMAR SPEC

Priority order. **P0 is a prerequisite, not an option** — every addition below inherits P0's bugs if it is skipped.

### P0 — Precedence-climbing parser (correctness prerequisite)

Replace the regex cascade in `parseExpressionUncached` (runtime.ts:1743-1989) with lexer → Pratt parser → validator → interpreter. Fixes, all empirically confirmed at HEAD:

| Bug | HEAD behaviour | Severity |
|---|---|---|
| `expr.startsWith('!')` tested at :1814 *before every binary operator* | `!a \|\| b` evaluates as `!(a\|\|b)` → **wrong value, no diagnostic**. With `a=1,b=2`: `!a \|\| b` → `false` (JS: `2`); `!darkMode && count` → `true` (JS: `2`) | data-corruption class, in the path about to become default |
| `RE_TERNARY` (:475) is string-blind | `data-bind:href="{ok ? 'https://a' : 'https://b'}"` is **rejected** — a `:` inside a string literal kills the match | the single most common `data-bind` idiom |
| Nested ternary in the *then* branch | `a === 1 ? (b === 2 ? 'x' : 'y') : 'z'` rejected | arbitrary cliff |
| Unresolvable identifier as call arg | `items.filter(Boolean)` parses, then **throws a raw `TypeError` out of the reactive effect** (:1684) | uncaught throw in user code |
| No-branch-matched → `return null` → fall through to eval | a hostile string *no branch understood* was still executed | security (see §3) |

**Demand:** `csp-parser-precedence.test.ts` exists and passes today *because it never tests `!` against a binary operator*. The corpus contains `!(a && b)` (works) and `{visible = !visible}` (works) — the bug hides in the gap between them.

### P1 — Arrow-function callback in higher-order-method argument position

`items.filter(i => <expr>)`, `.map`, `.some`, `.every`, `.find`, `.findIndex`, `.flatMap`, `.reduce`, `.sort`.

- AST: `ArrowFunction { params: Identifier[], body: Expression }`.
- 1–3 simple identifier params. No destructuring, no defaults, no rest, no `this`.
- **Expression body only.** No block bodies, no `return`, no statements, no assignment.
- Legal **only** as a direct argument in the callback slot of an allowlisted higher-order method. The validator enforces *position*: an arrow may not be assigned, stored in an array or object literal, used as a computed key, returned as the value of an expression, or passed anywhere else. Arrows are therefore **not first-class values** — no function factories, no deferred invocation, no recursion, no way to name a function.
- Nesting depth ≤ 2 (flagship needs 1).

**Demand: RANK 1 — this is the entire flagship gap.** Run verbatim with eval off, the README example renders **"Found undefined results"** and an **empty `<ul>`**, emitting exactly two diagnostics, both "arrow function detected": `README.md:206` (`data-computed`) and `README.md:213` (`data-list`). Every other directive in that example already works. One form, twice.

### P2 — Expression statements in `data-on:*` handlers

Allow a parsed call/member expression to stand alone as a handler statement, evaluated for effect and discarded: `$el.classList.toggle('active')`, `$refs.myInput.focus()`, `$dispatch('selected', {id})`.

**Demand: RANK 2, 9 occurrences, the largest count in the corpus** — and the reason **all three documented magic-variable examples in the README directive table fail** (README.md:259, :260, :261), plus `el-magic-safety.test.ts:60,:76,:137` and `runtime-refs.test.ts:39,:82`. `parseHandler` (:2084) today has no call-statement form at all except the hardcoded `$refetch('literal-id')` special case at :2183 — that special case is the tell that the general branch is missing.

### P3 — `$event` / `event` in the CSP-safe path

Inject into the handler's child scope (as `$el`/`$dispatch` already are at :2384-2394) instead of existing only as `new Function` parameters (:2246). Delete the `RE_EVENT_REF` bail-out in `parseIfHandler` (:1048). Gate reads through a `SAFE_EVENT_PROPS` allowlist proxy mirroring `SAFE_EL_PROPS` (:2341): `target`, `currentTarget`, `key`, `code`, `detail`, `value`, `checked`, `clientX/Y`, `shiftKey`/`ctrlKey`/`altKey`/`metaKey`, `preventDefault`, `stopPropagation`.

**Demand: RANK 3 — zero corpus occurrences, but it is a correctness bug, not a gap.** `{query = $event.target.value}` **parses, emits no diagnostic, sets no `data-forma-handler-error`, and silently writes `undefined`.** That is strictly worse than rejection. `$event`/`event` are documented magics (runtime.ts:119-120) and `$event.target.value` is the first thing an Alpine/Vue migrant types.

### P4 — Member and computed assignment in handlers

`a.b = expr`, `a.b.c = expr`, `a[k] = expr`, plus compound and increment on member paths (`item.done = !item.done`, `obj.n += 1`, `item.count++`). Today `RE_ASSIGN` (:547) and `RE_COMPOUND` (:548) require a bare `\w+` target, so even `$el.style.color = 'red'` and `$x = 1` are rejected.

**Demand: RANK 4** — `el-magic-safety.test.ts:121`, and the runtime is inconsistent with itself: `data-model` already implements exactly this write semantics for member paths (:2516-2530 resolves `basePath` + last key and assigns). You can two-way-bind `{item.name}` but cannot write `item.name = x` in a handler. Natural partner of P2 for the canonical todo-row interaction.

### P5 — Real prefix-unary tier

`typeof x`, unary `-x` / `+x` on non-literals, and `!` at its correct (highest) precedence.

**Demand: RANK 5** — `el-magic-safety.test.ts:34,:47,:168` use `typeof $el.ownerDocument` / `parentNode` / `innerHTML`. **These are the tests that prove the `$el` allowlist blocks DOM escape, and today they only exercise the eval path** — the security property they assert is untested on the build about to ship as default. Unary minus has zero corpus hits but `-1` working while `-count` fails (RE_NUMBER at :470 permits a leading `-` only on a literal) is the kind of arbitrary hole reviewers screenshot.

### P6 — Object literals

`{a: 1}`, `{a: expr}`, shorthand `{id}`. Keys restricted to identifiers and string literals; `__proto__`/`constructor`/`prototype` **rejected at parse time** (reuse `FORBIDDEN_STATE_KEYS`, :2290) *and* at runtime by `safeKey`. No computed keys, no getters/setters, no spread (see Tier B).

**Demand: RANK 6** — `README.md:260` `{$dispatch('selected', {id})}` is blocked by **both** P2 and P6; shipping P2 without P6 leaves that documented line still broken. Object literals are the payload shape for every `$dispatch` a user will write.

### P7 — General computed / chained member access

`obj[key]`, `items[i]`, `items[idx + 1]`, `items[0].name`, `obj.list[0]`, `obj['a']['b']`, `items?.[0]`, `obj?.['key']`. Fold a `Computed` step into the member-chain parse; **retire `RE_BRACKET` (:474/:1820)** whose regex demands a bare-identifier base, an integer-or-quoted key, and whole-expression coverage.

**Demand: RANK 7 — zero corpus hits, but this is also a security *win*.** `items[0]` working while `items[0].name` fails is an arbitrary cliff that generates bug reports the moment CSP-safe becomes default. More importantly: the bracket branch at :1820-1833 **does not check `UNSAFE_METHOD_NAMES`** (the dot branch does, at :1636), so `items['constructor']` is accepted by the *CSP-safe* parser today (§3.1). Checking the *evaluated* key at access time is strictly stronger than the string-concatenation regex heuristics in `findBlockedMethod` (:658-686), which can then be deleted.

### P8 — Frozen `SAFE_GLOBALS` namespaces

`Math` (already, but as a real intrinsic today at :1665 — replace with a frozen table), `JSON.stringify/parse`, `Object.keys/values/entries`, `Array.isArray/from`, `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `Date.now`. Frozen, null-prototype, interpreter-owned tables of captured intrinsics — **never a `globalThis` lookup**.

**Demand: RANK 8 — ship it, with one test-fixture change.** `{JSON.stringify(obj)}`, `{Object.keys(obj)}`, `{Array.isArray(items)}` currently parse, emit **no diagnostic**, and silently return `undefined` (only `Math` is known, :1665). Silence is the worst of the three options. Note `runtime-hardening.test.ts:37,:58` use `{count = Number('4')}` *as the fixture for asserting the blocked path* — that fixture must be swapped for something permanently denied (e.g. `{count = window.outerWidth}` or `{count = items['constructor']}`), which is a better test anyway.

---

### THE LINE — what stays unsupported, permanently, and why that is right

This is not a backlog. These are the properties that make the interpreter safe, and giving any of them up costs more than it buys.

| Never supported | Why it is the right line |
|---|---|
| Statements/blocks inside expressions; `;`, `var/let/const` | Expressions are values. Handlers already have a statement grammar. |
| `while`/`for`/`do`, generators, `async`/`await` | **Termination is guaranteed by construction.** With no loops and no recursion, every expression is total. That is a claim Alpine and Vue cannot make about runtime expressions. |
| Named functions, function declarations, arrows escaping the callback slot | Non-escaping arrows cannot be stored, re-invoked, or made recursive — which is precisely why they add no attack surface and no non-termination. |
| Bare calls `f(x)` where `f` is a state value | A function held in state is never invocable, so an app that puts a function in state cannot be tricked into calling it with attacker-chosen args. |
| `.call` / `.apply` / `.bind`, dynamic method lookup | These are the escalation step in the verified CSP-path exploit (§3.1c). They are in no table, therefore unreachable. |
| `new`, `delete`, `in`, `instanceof`, regex literals, comma operator, `**` on non-numbers, chained assignment `a = b = 1` | No demand; each is a new semantic surface with no offsetting value. |
| Any global not in `SAFE_GLOBALS`; `window`, `document`, `fetch`, `localStorage`, `globalThis`, `process` | Unreachable **by construction** — identifier resolution never consults `globalThis`. |
| String escapes `\u`, `\x`, octal | Kills the unicode-escaped-key bypass (A2, §3.1b) at the lexer, before semantics exist. |
| Destructuring, default/rest params, computed object keys, getters/setters | Destructuring triggers getter side effects during binding on untrusted (T2) data. |
| `this` | No receiver to leak. |

**Tier B — deferred, not refused:** spread `[...items]` and `{...obj, k: v}`. Zero occurrences in README, CSP.md, `examples/`, `e2e/` or the unit tests; the only mentions are synthetic probes and the hint string at runtime.ts:2004 that already directs users to `.concat()`. `.concat()` plus P4 member assignment covers the demand. The AST already carries element/property lists, so spread is a small additive change **if evidence appears** — it does not gate this release.

---

## 3. THE SECURITY MODEL

### 3.1 Why the current design cannot be patched (verified, not asserted)

**(a) The `with()` + `Proxy` "sandbox" is not a sandbox.** `buildEvaluator` :2054-2066 (identically `buildHandler` :2246-2261):

```js
const fn = new Function('__scope', `with(__scope) { return (${cleaned}); }`);
const proxy = new Proxy(Object.create(null), {
  has(_, key) { return key in scope.getters; },   // :2058 — THE BUG
  get(_, key) { if (UNSAFE_METHOD_NAMES.has(key)) return undefined; ... },
});
```

`with`'s `has` trap answers *"is this binding mine?"*. Returning `false` does not mean "undefined" — it means *"not mine, keep walking the real scope chain"*, terminating at the global object. Every identifier not in `scope.getters` resolves to the **real global**. Probed and passing, unblocked: `typeof globalThis` → `"object"`, `typeof process` → `"object"`, `Object.getOwnPropertyNames(globalThis).length` → 125. In a browser that is `document`, `fetch`, `localStorage`, `window`. The `get`-trap check only fires for root lookups; once you hold any real object, member access bypasses the proxy entirely.

**(b) `findBlockedMethod` is a static string scan, so any computed key defeats it.** Four working bypasses, all reported PASSED while the three baseline forms were correctly BLOCKED:

- `items[key]` where a state key (from server JSON — threat T2) is `"constructor"`
- `items['constructor']` — the regex sees no literal `constructor`
- `items[String.fromCharCode(99,111,...)]`
- `items['xconstructorx'.slice(1,12)]`

Escalation verified end to end: `items[key] === Array` → `items[key][key] === Function` → `Function('return typeof process')()` executes. Arbitrary code execution, invisible to a string scan **by construction** — the blocked name never appears in the source.

**(c) The most important finding: the CSP-safe path has the same hole, in the hardened build, with no `new Function` in the library.** Two facts combine: `buildEvaluator` (:2020-2025) tries `parseExpression` **first** and only calls `findBlockedMethod` on the eval fallback (:2041) — so for anything the CSP parser accepts, `findBlockedMethod` **never runs**; and the bracket branch (:1820-1833) does not check `UNSAFE_METHOD_NAMES`. A chain of ordinary `data-computed` attributes therefore reaches: `items['constructor']` → `Array` → `['constructor']` → `Function` → `.call(null,'return 1+1')` → `2`. Under a genuine strict CSP header the browser blocks the final `Function()` invocation — but steps 1–2 and `.call/.apply/.bind` are **CSP-independent**: `Array.prototype`, `Object` statics, and arbitrary `this`-retargeting of any function the app puts in state remain reachable. Honest statement: **the hardened build today provides no defence of its own; it delegates 100% of the defence to the header.**

Separately verified sandbox hole in the "safe" path: `$refs` returns **raw, unproxied elements** (:3021-3028). Under `locked-off`, `data-text="{$refs.r.ownerDocument.location.href}"` returned the real URL with zero diagnostics.

**The structural lesson.** A blocklist over a full evaluator must enumerate every hostile input; the evaluator's semantics are the attacker's toolkit. An allowlist over an AST inverts this: the interpreter's semantics are the *only* toolkit, and it contains nothing dangerous. There is no equivalent of (b) against a table lookup, because `"constructor"` is not a key in any table.

### 3.2 Threat model (goes into SECURITY.md — it drives every rule below)

- **T1 — attacker controls the expression source.** Any app that server-renders user content into markup, or has any HTML-injection sink, hands the attacker a `data-computed` / `data-on:click` string. Worse: `startObserver` (:3171) + `processMutation` (:3093) auto-bind **injected** elements, so *every HTML injection sink is also an expression sink*. This is the model the grammar must survive.
- **T2 — attacker controls values, not source:** `data-fetch` JSON, `data-forma-state`, `localStorage` via `data-persist`.
- **T3 — resource exhaustion:** huge arrays / nested callbacks from T2 hanging the main thread.

Current design fails T1 outright and T2 partially, for one architectural reason: blocklist a hostile string, then hand it to a full JS evaluator.

### 3.3 The five guarantees (each mechanical, each testable)

**G1 — Closed token set.** The lexer never hands source to JS. It recognises only identifiers `/[A-Za-z_$][\w$]*/`, numbers, single/double-quoted strings, template literals, and a fixed punctuator list. Anything else is a `LexError`. Escapes decoded: `\n \t \r \\ \' \" \` \0` only — **`\u`, `\x` and octal are rejected**.

**G2 — Total consumption.** The parser must end at EOF. Leftover tokens are an error, **never a silent fallback**. This is the direct fix for the cascade's `return null` → fall-through-to-eval shape.

**G3 — Exhaustive union.** AST nodes are a closed TS discriminated union. Validator and interpreter both end with `default: { const _x: never = node; throw new FormaInternalError(); }`. **Adding a node kind without adding both a validator case and an interpreter case is a compile error.**

**G4 — Validator is not the interpreter.** Two independent passes. The validator asserts node kinds, shape constraints (arrow only in HOF-argument position), arity, depth, node count. The interpreter **re-asserts** the safety-critical invariants (key filter, receiver kind) at runtime rather than trusting the validator.

**G5 — No escape hatch, ever.** No path to `new Function`, `eval`, dynamic property dispatch, or the real intrinsics. Enforced in CI by a grep gate over `src/expr/**` rejecting `new Function`, `eval(`, `constructor`, `setTimeout`, `import(`, and any bare `recv[key]` member read outside the two audited helpers. **Review rule: any future "just let people call X" is answered by adding X to a table, never by widening dispatch.**

### 3.4 Identifier resolution — the no-fall-through rule

The interpreter carries an explicit environment: a linked list of frames it owns. Resolution is a dictionary lookup in FormaJS structures, so global fall-through is not merely blocked, it is **unrepresentable** — there is no code path that consults `globalThis`.

1. Arrow parameter frames (innermost outward)
2. `data-list` item locals (`item`, `$item`, `$index`, `$key`) — `createChildScope` (:162)
3. Element magics (`$el`, `$dispatch`, `$refs`, `$refetch`, `$event`) — proxied by allowlist
4. Namespace bindings (`Math`, `JSON`, `Object`, `Array`, `Number`, `String`, `Boolean`) — **frozen interpreter tables, not the real intrinsics**
5. `scope.getters` (state + computed)
6. → **UNRESOLVED: throw `FormaUnresolvedIdentifier`. Never `undefined`. Never globals.**

Writes exist only in handlers, only via `scope.setters[name]` for a declared state key or an allowlisted member path; an unknown target reports an error instead of today's silent `scope.setters[name]?.(val)` no-op (:2154).

### 3.5 Member access and method dispatch — the core rule

**The interpreter never evaluates `recv[key]` to obtain a function.** Methods resolve from a frozen table keyed by **receiver kind**, and the **original intrinsic** is invoked:

```js
kind = kindOf(recv);                       // Array.isArray / typeof — never instanceof, never a property of recv
tbl  = METHODS[kind];
if (!tbl || !hasOwn(tbl, safeKey(m))) throw FormaMethodDenied(kind, m);
Reflect.apply(tbl[m], recv, args);         // captured intrinsic, frozen at module init
```

This one rule defeats, by construction: dynamic-key constructor access (bypasses a–d), prototype-pollution reach, receiver-supplied method impersonation (a T2 object with its own `filter` is not an Array, so `filter` is not offered — and even for a real Array we call the intrinsic, not the own property), `Array.prototype` poisoning by other page scripts, getter side effects on the method-lookup step, and `.call/.apply/.bind` escalation.

Two audited helpers — **the only places member access is implemented**:

- **`safeKey(k)`** — coerce to string; reject symbols; reject if in `DENY_KEYS`; reject length > 128. Applied to **every** key at runtime whatever its syntactic origin (static `.name`, static `['name']`, computed `[expr]`, template-literal key). Also applied statically to literal keys for a good authoring error, but **the runtime check is the security boundary** — which is what makes bypasses (a)–(d) all equivalent and all rejected.
- **`safeRead(recv, key)`** — (1) null/undefined → optional-chaining semantics or `FormaNullAccess`; (2) `safeKey`; (3) dispatch by receiver kind; (4) allowlisted accessor (only `length` on array/string); (5) plain object/array data key → require `Object.prototype.hasOwnProperty.call(recv, key)`, then `Object.getOwnPropertyDescriptor` and **require a data descriptor — an accessor descriptor is rejected**, so a poisoned getter can never run; never walks the prototype chain; (6) otherwise `FormaPropertyDenied` (reported, not `undefined`).

Call forms are exactly three: `MethodCall` on an allowlisted receiver kind, `NamespaceCall` on a frozen namespace table, `MagicCall` for the runtime's own functions (`$dispatch`, `$refetch`). Mutating array methods are excluded; `sort`/`reverse` operate on a defensive copy so evaluating an expression can never mutate reactive state outside the setter path.

**Under T2 (untrusted values), explicitly:** JSON cannot carry functions, so untrusted data never contributes a method. `JSON.parse('{"__proto__":{…}}')` creates an *own* property named `__proto__`; `safeKey` rejects the key, so it is unreadable. A string value `"constructor"` used as a computed key hits `safeKey` at runtime — bypass (a) closed.

### 3.6 Resource safety

Termination is by construction (no loops, no recursion, no generators — the language is **total**). Budgets bound *cost*, not hanging:

- **Parse time:** `MAX_SOURCE_LENGTH` 4096; `MAX_AST_NODES` 512; `MAX_AST_DEPTH` 32 (also prevents interpreter stack overflow); `MAX_ARROW_DEPTH` 2; `MAX_CALL_ARGS` 4.
- **Eval time:** `EvalContext` step counter incremented on every node visit **and every callback invocation**; `STEP_BUDGET` 100 000, configurable via `data-forma-expr-budget` on the `<script>` tag alongside existing `data-forma-*` config (`readRuntimeConfig`, :234). `MAX_ARRAY_LENGTH` 1 000 000 on results of `map/filter/concat/slice/flat/flatMap/split`; `MAX_STRING_LENGTH` 1 048 576 on `repeat/padStart/padEnd/join/concat` and every string `+` (native `repeat` only throws near 1e9; 1e8 succeeds and costs 100 MB, so the cap must be ours); `repeat` count ≤ 10 000; `flat` depth ≤ 8, `Infinity` rejected.
- **Scheduling:** keep `yieldToMain` (:394) for large `data-list` evaluations.

### 3.7 Failure semantics — no more silent `undefined`

Today failure is indistinguishable from success-with-undefined in at least four places (`:1636` returns a *truthy* function for a blocked expression, so the caller records a **successful parse**; `:1682`; `:2034/2048/2072` cached `() => undefined`; `:2220/2238/2280` `() => {}`). That is exactly how a flagship README example could be non-functional on the hardened build without anyone noticing.

- **R1 — no `undefined`-as-error.** Internal evaluation returns `{ok:true,value} | {ok:false,error}`. `{ok:true, value:undefined}` is a legitimate result and must be distinguishable from failure. Lint rule bans `catch { return undefined }` in the interpreter.
- **R2 — parse/validate failure is loud at bind time, in production too**, deduped once per (expression, element): `console.error` with the expression, offending token + column, receiver kind, element `outerHTML` head, and an actionable hint (extend `cspExpressionHint`, :2003); `reportDiagnostic` (:290) with a stable code (`FORMA_E_METHOD_DENIED`, …); a **`data-forma-error` attribute** on the element; and the binding **does not render** — it leaves existing content untouched and **never writes the string "undefined"**. Dev build additionally throws; `data-forma-strict` throws in production too.
- **R3 — runtime failure** (`safeKey` denial, receiver-kind mismatch, unresolved identifier, budget exceeded) throws `FormaExpressionError`, caught at the **binding boundary**, never swallowed, reported the same way.

### 3.8 Adversarial test list (ships as `src/expr/__tests__/adversarial.test.ts`)

Every case must be **denied with a reported diagnostic** — not silently `undefined`.

**Constructor / prototype reach:** `items.constructor` · `items['constructor']` · `items[key]` with state `key="constructor"` · `items['constructor']` · `items['cons'+'tructor']` · `items['xconstructorx'.slice(1,12)]` · `items[String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114)]` · `({}).constructor.constructor('return 1')()` · `items.__proto__` · `Math.constructor` · object literal with a `__proto__` / `constructor` / `prototype` key (parse error).

**Global reach:** `document.title` · `window` · `globalThis` · `fetch('/x')` · `localStorage.getItem('k')` · `process` · `top.location` · `self.name` · `console.log(1)` (unresolved identifier, reported).

**DOM escape:** `$refs.r.ownerDocument.location.href` (**returns the real URL today**) · `$refs.r.ownerDocument` · `$el.ownerDocument` / `$el.parentNode` / `$el.innerHTML` (the three `typeof` tests, now running on the CSP path) · `$event.view.window` · `$el.getRootNode()`.

**Function-value escalation:** `Math.floor.call(null,1.2)` · `items.filter.call(items, f)` · `items.filter.bind` · `fn` where state holds a function (unresolved as a call target) · `items.map(i => i).constructor`.

**Arrow-escape:** `x = i => i` · `[i => i]` · `{f: i => i}` · `items[i => i]` · `items.filter(i => (j => j)(i))` at depth 3 · arrow with a block body · arrow with destructured param — all parse errors.

**Poisoning / T2:** `Array.prototype.filter` overwritten by another page script → interpreter still uses the captured intrinsic · state object with an own `filter` function → not invoked · state object with an accessor descriptor → `FormaPropertyDenied`, getter never runs · `JSON.parse('{"__proto__":{"x":1}}')` own-key read → denied · `items.sort((a,b)=>a-b)` does not mutate reactive state.

**Budget / resources:** triple-nested `map` over 200 items → `FormaBudgetExceeded` · `'x'.repeat(1e9)` and `'x'.repeat(1e8)` → denied · source > 4096 chars → parse error · depth > 32 → parse error · `[].flat(Infinity)` → denied.

**Documented residual risk:** `String(x)` coercion in template literals and `Array#join` can invoke a value's `toString`. JSON data cannot supply one; an app that puts class instances in state can. Goes in `SECURITY.md` under residual risks.

---

## 4. IMPLEMENTATION PLAN

New code lands in **`src/expr/`** as new files. `src/runtime.ts` is being edited by parallel agents — the runtime diff is deliberately one late, small work item (WI-6/WI-7/WI-8) rather than a rolling edit. Re-anchor all HEAD line numbers before patching.

| # | Work item | Files | The test that proves it |
|---|---|---|---|
| **1** | Lexer: closed token set, escape policy (`\u`/`\x`/octal rejected), position tracking for diagnostics | `src/expr/lexer.ts` | `src/expr/__tests__/lexer.test.ts` — every punctuator round-trips; `c` is a `LexError`; unterminated string/template errors carry a column |
| **2** | AST types + Pratt parser; **total consumption or error** | `src/expr/ast.ts`, `src/expr/parser.ts` | `parser-precedence.test.ts` — **`!a \|\| b` === `2`** (the HEAD bug), `!a ? 1 : 2` === `2`, `a ? 'http://x' : 'y'`, `a === 1 ? (b === 2 ? 'x' : 'y') : 'z'`, `1 + 2*3 - 4` === `3`, `10-2-3` === `5`; trailing-token input errors |
| **3** | Validator: exhaustive union, arrow position rule, node/depth/arity limits | `src/expr/validate.ts` | `validate.test.ts` — every arrow-escape case from §3.8 is a validate error; `MAX_AST_DEPTH`/`MAX_AST_NODES` trip; a `never`-exhaustiveness compile check |
| **4** | **The allowlist, in one file**: `DENY_KEYS`, `METHODS` by receiver kind, `SAFE_GLOBALS`, `SAFE_EL_PROPS`, `SAFE_EVENT_PROPS`, `HOF_METHODS` | `src/expr/allowlist.ts` | `allowlist-snapshot.test.ts` — asserts the **exact sorted name list**; any addition fails CI until the snapshot is updated in the same PR (see §5 guardrail) |
| **5** | Interpreter: env frames, `safeKey`/`safeRead`, `Reflect.apply` dispatch, step budget, tagged results | `src/expr/interp.ts` | `interp.test.ts` (semantics, incl. flagship expression verbatim) + `adversarial.test.ts` (§3.8, all denied + reported) |
| **6** | Wire into the runtime: `buildEvaluator`/`buildHandler` call the interpreter. **Delete** `parseExpressionUncached`, `parseChainedAccess`, `parseHandler`, `parseIfHandler`, all parser-only `RE_*`, `findBlockedMethod`, the `new Function` fallback, `_allowUnsafeEval`/`setUnsafeEvalMode` | `src/runtime.ts` | `build-artifacts.test.ts` extended — **`new Function` and `with(` absent from *every* dist artifact**, not just hardened; `runtime-csp-default.test.ts` passes with no eval mode to set |
| **7** | Handler statement grammar: expression statements (P2), member/computed assignment + compound + `++`/`--` (P4) | `src/expr/handler.ts`, `src/runtime.ts` | `handler-grammar.test.ts` — `$el.classList.toggle('x')`, `$refs.p.focus()`, `$dispatch('e',{id})`, `item.done = !item.done`, `obj.n += 1`; unknown assignment target **reports**, never silently no-ops |
| **8** | Magics through the interpreter env: `$event`/`event` with `SAFE_EVENT_PROPS` (P3), **`$refs` returns proxied elements** (closes the :3023 escape), `$el`, `$dispatch`, `$refetch` as `MagicCall` | `src/runtime.ts`, `src/expr/magics.ts` | `magic-safety.test.ts` — `{query = $event.target.value}` **works**; `$event.view` denied; `$refs.r.ownerDocument.location.href` denied (**passes only after this WI**); `el-magic-safety.test.ts` `typeof` cases now run on the CSP path |
| **9** | Failure semantics R1–R3: tagged results, `data-forma-error`, deduped `console.error` + `reportDiagnostic`, no cached silent noop, dev-throw + `data-forma-strict` | `src/runtime.ts`, `src/expr/errors.ts` | `failure-semantics.test.ts` — a denied expression leaves prior text untouched, never renders `"undefined"`, sets `data-forma-error`, emits exactly one `formajs:diagnostic` per (expr, element) |
| **10** | **Flagship README test (executable shop window).** Extract the fenced HTML block at `README.md:193-230` **from the file at test time** (regex-locate the block after "Here's what you get from a single HTML file"), mount it, assert documented behaviour | `src/__tests__/readme-flagship.test.ts` | Asserts: `data-text` reads **"Found 5 results"**; `<ul>` renders **5 `<li>`**; typing `"apple"` into `data-model` yields "Found 1 results" and 1 `<li>`; `data-show` "No matches found." appears for `"zzz"`; `data-bind:data-theme` toggles `light`→`dark`; **`getDiagnostics()` is empty**. Fails if the README block is edited into something unsupported |
| **11** | **Directive-table test.** Extract every `Example` cell from the README table (`README.md:243-262`) and assert each parses clean | `src/__tests__/readme-directive-table.test.ts` | Zero diagnostics for all 17 rows, including `{$el.classList.toggle('active')}`, `{$dispatch('selected', {id})}`, `{$refs.myInput.focus()}` — the three that fail today |
| **12** | e2e under a **real** strict CSP header | `e2e/fixtures/flagship.html`, `e2e/runtime.spec.ts` | Playwright route-fulfils with `Content-Security-Policy: script-src 'self'`; asserts the 5 `<li>`, the filter, and **zero CSP violations** in `page.on('console')`. This is the artifact behind the front-page claim |
| **13** | Fix the dead CSP example: `examples/csp/index.html` loads `../../dist/forma-runtime-csp.js`, which **no build target emits** | `examples/csp/index.html` | Add to `verify-dist.mjs`: every `<script src>` in `examples/**` resolves to an emitted artifact |
| **14** | **Size gate for the bundle that becomes the default.** `scripts/check-size.mjs` `GATES` covers `dist/index.js` (30 000, graph-walked), `formajs-runtime.global.js` (31 000), `forma.esm.js` (29 000) — **`formajs-runtime-hardened.global.js` is gated nowhere, in `ci.yml` or `release.yml`** | `scripts/check-size.mjs`, `.github/workflows/*.yml` | `check-size.test.ts` — hardened IIFE gated at **28 000 B gzip**; gate fails on a deliberate +3 KB stub |
| **15** | Truth pass over the docs | `README.md`, `CSP.md`, `SECURITY.md`, `package.json` | `CSP.md:56` claims `new Function` → "**No** — CSP-safe expression parser used instead", false for the standard build today — becomes true only after WI-6. `SECURITY.md:24-27` describes the `with()`+`Proxy` as a sandbox — replace with §3.1 + the T1/T2/T3 threat model + residual risks. `README.md:8` claims the core entry is "~8 KB gzipped"; `dist/index.js` is 9,035 B but pulls 13,676 B of chunks — **the honest figure is 22.2 KB**. `README.md:234/237` should stop pointing users at a separate hardened build once both are eval-free |
| **16** | CI guardrails (§5) | `.github/workflows/ci.yml`, `scripts/verify-dist.mjs` | grep gate over `src/expr/**` for `new Function`/`eval(`/`constructor`/`setTimeout`/`import(`/bare `recv[key]`; `verify-dist.mjs` asserts no `new Function` in **any** artifact |

**Sequencing:** 1→2→3→4→5 are pure new files and can land before the runtime is quiet (they carry their own tests and no runtime diff). 6→7→8→9 are the runtime landing, best done as one coordinated PR once the parallel `runtime.ts` work settles. 10→12 are the shop-window locks and should land in the *same* PR as 6-9 so the claim and the proof ship together. 13-16 are independent and can land first — **WI-14 in particular should land immediately**, since the ungated bundle is the one about to become the default.

**One hard constraint, repeated because it is the whole cost case: replace, do not layer.** Keeping the regex parser as a "fast path" in front of the interpreter makes the delta **+6.1 KB instead of +1.7 KB** and leaves two grammars that must agree — a permanent bug farm.

---

## 5. COSTS AND RISKS

**Bundle — measured through the repo's real `tsup` hardened-IIFE pipeline, not estimated:**

| | raw | gzip | min+gzip |
|---|---|---|---|
| A. hardened baseline (today's CSP build) | 115,106 | 24,033 | 16,100 |
| B. hardened, all grammar removed | 91,981 | 19,644 | 13,156 |
| C. hardened + AST interpreter | 119,354 | **25,748** | **17,547** |
| today's shipped default (contains 2× `new Function`) | 122,450 | 25,828 | 17,201 |

- Current regex parser + handler grammar = **4,389 B gzip (18.3% of the CSP runtime)**. The eval fallback = **1,738 B gzip**.
- Interpreter's own share (C−B) = **6,104 B gzip**. **Net delta (C−A) = +1,715 B gzip (+7.1%). Versus the bundle users download today (C−default) = −80 B (−0.3%).**
- **Honest margin:** the measured prototype had no diagnostic hints with source positions, no magic wiring, 21 tests. Budget **+25–40%** for production → interpreter share 7.6–8.5 KB, net **+2.1 to +2.7 KB**, landing at **~26.2–26.8 KB gzip / ~18.2–18.8 KB min+gzip**. **Gate at 28,000 B gzip (WI-14).**
- **Throughput:** flagship expression over 200 items × 5,000 iterations — native 5.97 µs/op, `new Function`+`with(proxy)` 51.82 µs/op, **AST interpreter 59.42 µs/op = 1.15× the eval path**. Both are dominated by the per-element callback; the eval path pays its own proxy `has`-trap on every identifier. **Removing eval is not a performance regression.**

**Complexity.** ~700–950 lines of new, self-contained, heavily-tested code in `src/expr/`, against ~477 lines of regex cascade deleted from `runtime.ts`. Net line count is roughly flat; net *comprehensibility* improves sharply — a Pratt parser plus a table is a thing a reviewer can hold in their head, and the regex cascade demonstrably is not (it shipped a lowest-precedence `!`).

**Risk 1 — the interpreter grows into a mini-eval over time.** This is the real long-term risk and it is what killed the current design. Guardrails, all mechanical:
1. **The allowlist lives in exactly one file** (`src/expr/allowlist.ts`) with a **snapshot test asserting the exact sorted name list** — any addition fails CI until the snapshot is updated in the same PR, which puts every capability grant in front of a reviewer by construction.
2. **CI grep gate** over `src/expr/**` rejecting `new Function`, `eval(`, `constructor`, `setTimeout`, `import(`, and bare `recv[key]` outside the two audited helpers.
3. **G3 exhaustive-union compile error** — a new node kind without validator *and* interpreter cases does not build.
4. **Written review rule in `CONTRIBUTING.md`:** *"Any request to support X is answered by adding X to a table, never by widening dispatch. If X cannot be expressed as a table entry, the answer is no."*

**Risk 2 — behaviour change for existing users.** Expressions that today silently render `undefined` (`{JSON.stringify(x)}`, `{$event.target.value}`, `{Object.keys(o)}`) will start either *working* (P3, P8) or *reporting loudly* (R2/R3) — and denied bindings now leave content untouched rather than writing `""`. Ship as a **minor** with a CHANGELOG migration note, and note the two deliberate fixture flips (`runtime-hardening.test.ts:37,:58` use `{count = Number('4')}` *as* the blocked-path fixture).

**Risk 3 — merge collision on `runtime.ts`.** Mitigated by structure: all new logic in new files, the runtime touched in one late coordinated PR (WI-6/7/8), all HEAD line numbers re-anchored before patching.

**Risk 4 — the interpreter has bugs the regex parser did not.** Mitigated by the adversarial suite (§3.8), the README-extraction tests (WI-10/11) which cannot drift from the docs, and the fact that the existing `csp-parser-extensions` / `csp-parser-precedence` / `csp-string-literal` batteries must keep passing unchanged — they become the regression corpus.

**Non-risk, worth stating:** size. The bundle users download does not grow. Anyone arguing size against this is arguing against a −0.3% change.

---

## 6. WHAT WE DO NOT DO

- **Precompile `data-*` attributes with `@getforma/compiler` (as the answer).** It deletes "No build tools installed" from the example it is meant to defend, and does nothing for the CMS/Rails/Shopify audience the HTML Runtime exists for. `@getforma/compiler` also has no HTML attribute pipeline today — it is net-new cross-repo work plus a compiled-thunk/runtime version contract. *Offer it later as an optional optimization ("compile your attributes, drop 4.4 KB" — probe B: 19,644 B gzip), never as the front-page answer.*
- **A nonce/hash-based CSP escape for eval.** **It does not exist.** Nonces and hashes govern `<script>` elements; only `'unsafe-eval'` permits dynamic code (`'wasm-unsafe-eval'` covers WebAssembly only). Writing that doc would mean writing something false. The nearest real mechanism (htmx's `hx-csp` injecting nonce'd `<script>` elements) is still arbitrary dynamic code execution, needs server-minted per-request nonces, and would be a second evaluation backend to build and secure — strictly worse than a 1.7 KB allowlist interpreter.
- **Keep the regex parser as a fast path in front of the interpreter.** +6.1 KB instead of +1.7 KB, and two grammars that must agree forever.
- **Keep the `new Function` fallback "for compatibility".** Its presence is what makes the `has`-trap bug reachable at all, and it makes `CSP.md:56` and `README.md:234` false on the standard build. If a legacy escape valve is ever required it must be a separately-named build, documented as requiring `'unsafe-eval'`, and **never described as CSP-safe**.
- **Retire or simplify the flagship example.** It is the product. It is also the only thing in the category that works under a strict CSP, and the competitive gap is wider than expected — every competitor either needs `unsafe-eval`, needs a build step, has no expression language, or ships a CSP evaluator that forbids callbacks and globals. The intersection is empty.
- **Ship spread (`[...items]`, `{...obj, k: v}`) in this release.** Zero occurrences anywhere in the corpus; `.concat()` plus member assignment covers the demand; the runtime's own hint string already directs users to `.concat()`. Additive later if evidence appears.
- **Add a "just this once" escape for arrows as values, bare `f(x)` calls, or `.call/.apply/.bind`.** Each is an escalation step in a *verified* exploit chain. The answer is a table entry or no.
