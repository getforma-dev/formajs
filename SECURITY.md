# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours and provide a fix timeline.

## Architecture & Trust Boundaries

FormaJS v1.0.0+ uses subpath exports to segment capabilities by trust level:

| Import | Capabilities | Trust Level |
|--------|-------------|-------------|
| `@getforma/core` | Signals, DOM, components, state, events, islands | No network, no eval, no filesystem — but see *Unsanitized HTML sinks* below |
| `@getforma/core/runtime` | HTML Runtime (data-* directives) | Allowlist AST interpreter. **No `eval`, no `new Function`, no `with()` in the artifact** — grepped by `scripts/verify-dist.mjs` |
| `@getforma/core/runtime-hardened` | HTML Runtime (tree-shaken bundling) | Identical source and identical guarantee; a second bundling, kept because two documented CDN URLs point at it |
| `@getforma/core/http` | `createFetch`, `createSSE`, `createWebSocket` | Network access (intentional) |
| `@getforma/core/storage` | `createLocalStorage`, `createIndexedDB` | Browser storage access (intentional) |
| `@getforma/core/server` (deprecated, removed in 3.0.0) | `$$serverFunction`, `handleRPC` | Network + `process.env` (server-side) |
| `@getforma/core/wasm` (deprecated, removed in 3.0.0) | `renderLocal`, `renderIsland` | Loads and instantiates a WASM module from `window.__FORMA_WASM__` |

The root entry's "no network" row is a real boundary, not a convention: `fetch`, `WebSocket` and the storage APIs live only behind their subpaths and are absent from the root barrel.

The proof is an EXACT export-surface pin per subpath, not a list of names asserted
absent: `toBeUndefined()` on a name the barrel never had passes with any typo and
can only fail if someone adds the export, whereas an exact set fails in both
directions — a network primitive leaking into the root barrel, and a documented
export silently disappearing from it.

Verified by: `src/__tests__/index-surface.test.ts` > "%s exports exactly the documented names"

### Unsanitized HTML sinks

`h()` builds DOM with `document.createElement` and writes text with `textContent`; the library never parses a markup string of its own. Four APIs deliberately opt out. **None of them sanitizes**, and all four should be treated as first-party-content-only:

- `dangerouslySetInnerHTML={{ __html }}` — prop on `h()` / JSX; assigns `innerHTML`.
- `setHTMLUnsafe(el, html)` — exported from `@getforma/core`; assigns `innerHTML`.
- `reconcile(container, html)` — exported from `@getforma/core/runtime`; parses an HTML string into a `<template>` and diffs it into the live page.
- The `srcdoc` attribute — the browser parses the *attribute value* as a document, so attribute escaping does not neutralize it. It is emitted (a sandboxed `<iframe srcdoc>` is legitimate) with a dev-mode warning.

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "emits srcdoc but warns that escaping does not neutralize it"

## Supply Chain Security Notes

### There is no `new Function` in the HTML Runtime

Expressions in `data-*` attributes are evaluated by an **allowlist AST interpreter** (`src/expr/`): lexer, precedence-climbing parser, validator, tree-walking interpreter. Every shipped artifact — `dist/runtime.js`, `dist/runtime.cjs`, both IIFE globals, the hardened pair, and the SSR/Node path — contains **zero `eval`, zero `new Function` and zero `with()`**. There is no opt-in switch, because there is no fallback to switch on: `setUnsafeEval()`, `isUnsafeEvalAllowed()` and `data-forma-unsafe-eval` were removed along with the code they guarded.

`scripts/verify-dist.mjs` greps every built artifact as the last step of `npm run build`, so this is asserted on the bytes that ship rather than inferred from the source.

Verified by: `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by: `src/__tests__/runtime-csp-default.test.ts` > "never constructs a function, not even one that would have succeeded"
Verified by: `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

### Threat model

Three models drive every rule below. They are written down because the design that preceded this one failed the first outright.

- **T1 — the attacker controls the expression SOURCE.** Any app that server-renders user content into markup, or has any HTML-injection sink, hands the attacker a `data-computed` or `data-on:click` string. Worse: the runtime's MutationObserver auto-binds *injected* elements, so **every HTML injection sink is also an expression sink**. This is the model the grammar has to survive.
- **T2 — the attacker controls VALUES, not source:** `data-fetch` responses, `data-forma-state` attributes, `localStorage` via `data-persist`.
- **T3 — resource exhaustion:** huge arrays or deeply nested callbacks from T2 data.

### Why an allowlist, and what the blocklist it replaced could not do

The previous design compiled the expression with `new Function` and ran it inside `with (proxy) { … }`, guarded by a nine-name blocklist. Two structural failures, both verified rather than theorised:

1. **`with()` + `Proxy` is not a sandbox.** The proxy's `has` trap answered `key in scope.getters`. Returning `false` does not mean "undefined" — it means *"not mine, keep walking the scope chain"*, terminating at the global object. Every identifier that was not a declared state key resolved to the **real global**: `document`, `fetch`, `localStorage`, `window`.
2. **A static string scan cannot see a computed key.** `items['constructor']`, `items[k]` with `k` from server JSON, `items['cons' + 'tructor']` and `items[String.fromCharCode(…)]` all reached `Array` → `Function`, and the blocked name never appeared in the source text. That chain worked in the *CSP-safe* path, in the hardened build, with no `new Function` in the library.

The replacement inverts the relationship. A blocklist over a full evaluator must enumerate every hostile input, and the evaluator's semantics are the attacker's toolkit. An allowlist over an AST makes the interpreter's semantics the *only* toolkit, and it contains nothing dangerous — there is no equivalent of (2) against a table lookup, because `"constructor"` is not a key in any table.

### The five guarantees

- **G1 — closed token set.** The lexer never hands source to JavaScript. It recognises identifiers, decimal numbers, quoted strings, template literals and a fixed punctuator list; every other byte is a syntax error with a column. Only the eight simple escapes are decoded — `\u`, `\x` and octal are rejected at the lexer, which kills unicode-escaped-key bypasses before any semantics exist to bypass.
- **G2 — total consumption.** The parser must end at EOF. Leftover tokens are an error, never a silent fallback. This is the direct fix for the "no branch matched, return null, fall through to eval" shape of the parser it replaces.
- **G3 — exhaustive union.** AST nodes are a closed TypeScript discriminated union, and the validator and the interpreter both end their switch with `const never: never = node`. Adding a node kind without adding both cases is a compile error.
- **G4 — the validator is not the interpreter.** Two independent passes. The validator asserts node kinds, shape constraints and budgets; the interpreter **re-asserts** every safety-critical invariant (key filter, receiver kind, call target) at evaluation time rather than trusting the validator.
- **G5 — no escape hatch.** No path to `new Function`, `eval`, dynamic property dispatch, or a real intrinsic, enforced by a gate that reads the source of `src/expr/**`.

Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "src/expr contains no path to the Function constructor or a global"
Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "no property is read off a value with a computed key outside safeRead"
Verified by: `src/expr/__tests__/validate.test.ts` > "every AST kind has a validator case and an interpreter case"

### Identifier resolution never consults `globalThis`

Names resolve against, in order: arrow-parameter frames, `data-list` row locals, element magics (`$el`, `$event`, `$refs`, `$dispatch`, `$refetch`), the scope's own state and computed getters, and one frozen null-prototype table of captured intrinsics (`Math`, `JSON`, `Object`, `Array`, `Date.now`, `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`). Then it **fails**, with a reported `FORMA_E_UNRESOLVED`.

`document`, `fetch`, `window`, `localStorage` and `process` are therefore not blocked — they are **unreachable**, because there is no code path that could find them. That is a property of the resolver's shape, not of a list someone has to keep current.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"

### Method dispatch never reads a property of the receiver

```
kind = kindOf(recv)                // Array.isArray / typeof — never instanceof
tbl  = METHODS[kind]
if (!hasOwn(tbl, safeKey(m))) throw MethodDenied
Reflect.apply(tbl[m], recv, args)  // captured intrinsic, frozen at module init
```

That one rule defeats, by construction: dynamic-key constructor access, prototype-pollution reach, receiver-supplied method impersonation (a T2 object carrying its own `filter` is not an Array, so `filter` is not offered — and even for a real Array the captured intrinsic runs, not the own property), `Array.prototype` poisoning by another page script, getter side effects on the method-lookup step, and `.call` / `.apply` / `.bind` escalation.

Two audited helpers are the **only** places member access is implemented:

- **`safeKey(k)`** — coerces to string, rejects symbols, rejects keys longer than 128 characters, and rejects `constructor`, `__proto__`, `prototype`, `__defineGetter__` / `__defineSetter__` / `__lookupGetter__` / `__lookupSetter__`, `eval`, `Function`, `call`, `apply`, `bind`, `caller`, `callee`, `arguments`. It runs on the **evaluated** key, whatever syntax produced it, which is what makes every spelling of a bypass the same case and all of them dead.
- **`safeRead(recv, key)`** — a nullish base yields `undefined` (absent data, not a failure); host receivers dispatch by kind; `length` is allowed on arrays and strings; a plain object or array data key requires an **own** property whose descriptor is a **data** descriptor, so a poisoned getter never runs and the prototype chain is never walked; anything else is a reported denial.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "every spelling of a constructor reach is denied"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "a poisoned Array.prototype.filter is not what runs"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "an accessor property is refused instead of invoked"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "a receiver's own filter is never invoked"

### The DOM is reachable only through a wrapper

`$el`, `$event`, `$refs` and everything they hand back — `classList`, `style`, `dataset`, `closest()`, `querySelector()`, `event.target` — are **wrapped**, and the wrapper survives every hop. Reads, writes and calls are restricted to fixed per-kind tables. `$el.ownerDocument`, `$el.parentNode`, `$el.innerHTML`, `$el.style.cssText`, `$event.view` and `$refs.x.ownerDocument.location.href` are denials with a diagnostic, not answers.

Before this, `$refs` returned the **raw** element, and `data-text="{$refs.r.ownerDocument.location.href}"` read the real page URL from inside a "CSP-safe" expression in the hardened build, with no diagnostic at all.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "$refs.r.ownerDocument.location.href is denied"
Verified by: `src/dom/__tests__/el-magic-safety.test.ts` > "$refs hands back a wrapped element, not the live node"

### Termination and budgets

The language has no loops, no recursion, no generators and no way to name or store a function, so **every expression terminates by construction** — an arrow is legal only in the callback slot of nine allowlisted array methods, and cannot be assigned, stored, returned or re-invoked. Budgets therefore bound *cost*, not hanging: 4,096 source characters, 512 AST nodes, depth 32, arrow nesting 2, four call arguments, and a 100,000-step evaluation budget configurable per page with `data-forma-expr-budget` on the script tag. The step budget counts interpreter nodes, not the work inside a built-in, so **every built-in call is also charged before it runs** against an allocation budget (DR-16): 250,000 units, where a unit is about the cost of one `Array.from` slot. A call pays a unit for each array slot or string character it produces or converts; string calls that amplify nothing (case mapping, searching, trimming, slicing) pay their measured cost per character. Case mapping is tiered by the costliest character of the text: Latin-1, and the general punctuation, currency signs and letterlike symbols that map to themselves (U+2000 to U+20CF, U+2100 to U+2125: curly quotes, dashes, `…`, `€`, `™`), lowercase at 1/32 of a unit a character; text whose first character above those is in a script whose ordinary text measured 4 to 19 ns a character (Latin Extended, Greek, Cyrillic, Armenian, Hebrew, Arabic, the Indic scripts, Thai, Vietnamese, CJK, kana, Hangul, emoji) at 1/16; anything else (Georgian, Cherokee, Greek Extended, fullwidth Latin) at 1/2. Turkish `İ` (U+0130) is a Latin Extended-A letter, so text with it is priced 1/16 too, though it lowercases to two characters and measured 27 to 30 ns. Lowercasing 260 characters of English therefore costs about 8 units, and of Greek about 16. A case-mapping call on more than 1,048,576 characters, the result cap it would pass anyway, is refused before it runs. Each call is charged the weight of its arguments as text (most built-ins convert an array argument with `join`; the few that read arguments as data, such as `Object.keys` and `Array.from`, are charged their element count instead, and a string method reads a string argument for a thirty-second of a unit a character), then its row in `src/expr/cost.ts` (`map` the receiver's length, `repeat` the receiver's length times the count, `Array.from` the length it is asked for, a default `sort` the comparisons and the length of each string element it compares, …). Converting an array or object with an operator (`'' + list`, `` `${list}` ``, `list < 1`, `x += list`) is charged the same way; `===`, and `==` against `null` or between two objects, convert nothing and are not charged.

**Operators on strings are charged too** (FORMA-028). Joining keeps the pieces as a rope, which the first read of it copies whole, so a short expression with no state could build a 524,288-character rope in 19 steps and read copies of it for seconds. Now `+`, `+=` and template literals pay a 128th of a unit for each character they build past 511; comparing two long strings pays a 128th a character compared; an operator that parses a long string as a number (`s * 1`, `-s`, `s < 1`, `s == 1`) pays an eighth a character; and comparing, or reading a character of, a string the same expression has just built with `+` pays for copying it (8 units plus a 32nd a character, to 512). Each case of the review that found this is refused in under 30 ms at 4x CPU throttling, where 2.0.3 took 0.6 to 4.3 s. A write that would grow an array past 250,000 elements is refused, so a handler cannot make a sparse array longer than one evaluation could build. Past the budget the call is refused with `FORMA_E_BUDGET` and never runs, so `Array.from({length: 12000000})` costs nothing, where 2.0.1 built a 139 MB array in a 300 ms task before refusing it. `repeat` ≤ 10,000 and `flat` depth ≤ 8 are refused before the call as before, and results stay capped at 1 MiB strings (now for `+=` too) and 1,000,000-element arrays.

**Both budgets are one per task, and one per event** (FORMA-028). The runtime keeps a meter of what the evaluations of the current task have spent, and every evaluation it starts counts on from it; one that starts inside another (a `data-computed` read by a binding, a handler that `$el.click()` or `$dispatch` reaches) spends the running one's budget. Ten bindings at the cap in one widget used to run ten budgets in one task, 382 ms at 4x. A binding refused only because the bindings before it in its task spent the budget is not reported: it re-runs in the next task, where it starts first, so the ten bindings render one task at a time, none over 42 ms at 4x (p99 of 41 runs). A binding over the budget on its own is reported as before; a computed refused inside a reader is evaluated alone at the start of the next task, so its failure is never cached as its answer. A binding waits only if the task had spent allocation units before it. A charge that a cost-table row sizes directly and that is larger than the whole budget is reported at once; a weighed value that heavy, arriving late in a busy task, is counted only to the room left, so it waits once, is weighed in full when it runs first, and is then reported once. Once a binding waits, each later charge in the task is counted only to 10,000 units: lighter bindings still render now, and heavier values are refused after counting that far, cheaply, and render in later tasks; a waiting binding is not weighed again in full in every retry (FORMA-173). A handler cannot be re-run later, so an event the runtime has not seen starts a fresh meter, and the handlers that event reaches as it bubbles share it; the bindings they update spend what is left, and render in the next task if it is not enough. The runtime's own conversions of a result to text (FORMA-025: `data-text`, `data-bind:*`, `data-model`, `data-persist`, and a `data-list` row's `{item}` placeholders and key) are charged the same way inside the binding's budget before they run, so a list of a thousand references to one 300,000-character string is refused before `String()` would write 300 million characters. The budgets are sized from the tail of measurements at 4x CPU throttling, with garbage collection counted (`scripts/measure-alloc-budget.mjs`, `scripts/measure-task-budget.mjs`).

**What the budgets do not bound.** The meter is zeroed by each event the runtime has not seen (`begin`), not only between tasks, so the events one task delivers each get a budget: one click or keystroke dispatches several, and a form submission one per control (review S1). A widget that binds handlers to all of them can spend a budget per event in one task; under A14 every widget is the founder's reviewed code, and that is carried with the cases below. A price per character cannot see content, and three costs depend on it. A string search whose pattern's first characters fill the text (`'ab'` in `'aaaa…'`) measured 39 ns a character at 4x where ordinary text takes under 1, so one evaluation of such searches ran up to 315 ms. A string stored two bytes a character (any string that held a character above U+00FF, or a slice of one) costs up to about four times its case-mapping tier's charge, so seven or eight `toLowerCase` calls on 1 million such characters ran 56 ms, and up to 100 ms for alternating-case text. And the tier of a text is read from its first character above Latin-1, because a full scan of two-byte text measured 6 to 7 ns a character, most of the cost of lowercasing it: lowercasing all-capital Greek measured up to 19 ns a character, about three times its 1/16 charge, so four calls on 960,000 such characters ran 73 ms, Turkish `İ` text, priced 1/16 with no prefix, 76 ms for one call on a million characters before the 1 MiB cap refused its two-million-character result, and text that opens with one Greek letter and continues in Cherokee (up to 39 ns a character) 90 ms. The bound is what one task's 4 million characters at 1/16 cost at the costliest lowercasing measured, about 40 ns a character: about 160 ms a task (review S3). Each is bounded per task, to one evaluation, not to 50 ms. And `data-list` builds its rows unpriced: one row measured about 14 µs at 4x in this release and in 2.0.3 alike, so a list passes 50 ms at about 3,500 rows, and a cheap expression can hand it 250,000 items (3.5 s); the remedy is chunked rendering under N3's list target, not the expression budget (FORMA-172). The largest ordinary evaluation is near the line too: the 9,000-record search measured 24 to 50 ms median at 4x across six scripts (ASCII 24 ms, Greek 50), where 2.0.1 measured 19 to 42 ms in the same session.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "a nested callback over a large array trips the step budget"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "an argument that would allocate hundreds of megabytes is refused"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "every allowlisted native refuses an argument heavier than the budget before it runs"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "every size-driven cost refuses a hostile size before the native runs"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "the budget is per evaluation and cumulative across its calls"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "an operator does not convert a value heavier than the budget"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "loose equality charges only an operand it converts"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a handler cannot grow an array past the allocation budget"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a native that reads its argument as data is charged its element count, not its text"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a text search over records is answered as on main"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "case mapping is charged by the costliest character of its receiver"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "every round-2 rope case is refused before the long task"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "a template literal and += are charged by the length they produce"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "comparing long strings is charged by the characters compared"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "comparing or reading a string just built is charged for copying it"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "an operator that parses a long string as a number is charged for it"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "a string method reads a string argument for a thirty-second of a unit a character"
Verified by: `src/expr/__tests__/ordinary-search.test.ts` > "a search over 900 and 9,000 records of %s text is answered"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "ten bindings at the cap spend one budget per task and all of them render"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a binding over the budget on its own is reported, not retried"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a chain of computeds spends one budget between them"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a computed refused inside a heavy reader is evaluated again on its own"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "the handlers one event reaches share one budget"
Verified by: `src/__tests__/runtime-text-cost.test.ts` > "data-text of a value heavier than the budget is refused before it is converted"
Verified by: `src/__tests__/runtime-text-cost.test.ts` > "every other conversion of a result to text is refused before it runs"

### Failure is always visible

An expression that cannot be compiled or cannot be evaluated is **not evaluated, and says so**: a `console.error` naming the code, the message and the column, a `formajs:diagnostic` event, an entry in `getDiagnostics()`, and a `data-forma-expr-error` / `data-forma-handler-error` attribute on the element. The binding writes nothing — the DOM keeps what it had, and the string `undefined` is never rendered. `undefined` is a legitimate VALUE, so it can never double as an error signal.

Verified by: `src/__tests__/failure-semantics.test.ts` > "a denied expression leaves the previous text in place and never renders undefined"
Verified by: `src/__tests__/failure-semantics.test.ts` > "a genuine runtime bug is not swallowed as an expression denial"

### Residual risks

- **`toString` coercion.** Rendering a value as text, interpolating it into a template literal, or `Array#join`-ing it calls that value's `toString`. JSON data cannot supply one; an app that puts class instances into state can. The method is then the app's own code, not the attacker's, under T2.
- **An expression is still code.** Under T1 the grammar bounds what an injected expression can *do* — no globals, no network, no DOM outside the allowlist, no non-termination — but it can still read and write the declared state of the scope it was injected into, and call the DOM methods on the allowlist. Never build a `data-*` attribute from user input.
- **`data-forma-expr-budget`** is read from the script tag. Anyone who can add that attribute can already run script on the page, so it grants no new capability.

### `fetch` in the HTTP module

`@getforma/core/http` uses the browser's native `fetch` API for `createFetch`, `createSSE`, and `createWebSocket`. This is opt-in — it is not included in the main `@getforma/core` entry point.

### `process.env` in the server module

`@getforma/core/server` reads `process.env.NODE_ENV` to determine whether to expose internal error messages in RPC responses (dev mode only). Production mode returns generic error messages.

### Published bundles are readable

All dist output is syntax-minified only: constant folding and dead-branch removal, with identifiers and line structure preserved. Nothing is mangled onto a single line, so supply-chain scanners do not see "obfuscated code". Syntax minification is what makes the build-time `__DEV__` flag real — without it esbuild leaves it as a variable nothing folds, and dev warnings survive into a production process.

Verified by: `src/__tests__/build-config.test.ts` > "enables syntax minification everywhere so the build-time flags fold"

## Security Hardening (v0.5.0 – 2.0.0)

- **`$el` safe proxy** (0.7.0, superseded): allowlisted `$el` reads through a Proxy. Superseded by the host-wrapper model above, which applies the same discipline to `$event` and `$refs` — the two the Proxy did not cover.
- **`findBlockedMethod`** (0.7.0, removed): a static scan for `constructor`, `__proto__`, `eval` and `Function` in expression text, including bracket concatenation. Removed with the evaluator it guarded; a string scan cannot see `items[k]` where `k` arrives from server JSON, and the allowlist interpreter checks the evaluated key instead.
- **Allowlist AST expression interpreter** (unreleased): replaced the regex parser and the `new Function` fallback outright — see *Supply Chain Security Notes* above.
- **SSR `escapeAttr` + scheme detection** (1.0.10): Escapes `<`, `>`, `'`, `"`, `&`. `isDangerousUrl` blocks `javascript:`, `vbscript:` and `data:text/html` in URL-bearing attributes, **normalizing away the whitespace/control characters browsers ignore in a scheme**, so `java\tscript:` is caught too. Attribute names are validated and `on*` handler attributes are dropped case-insensitively. Applies to the `data-bind:*` and `data-list` runtime sinks in both builds.
- **SSR swap script** (0.7.0): the JSON embedded in a Suspense swap script has `<`, `>`, U+2028 and U+2029 replaced with their unicode escapes, so a payload cannot close the script block.
- **CSP parser operator precedence** (0.7.1): Fixed to match JavaScript semantics (addition before comparison, AND before OR).
- **RPC argument sanitization + CSRF mitigation + authorization hook** (1.4.0): see the RPC section below.
- **Client/SSR sink parity, `data:image/svg+xml` context rule, store prototype guard, tag-name validation** (unreleased): see the URL scheme posture below and `CHANGELOG.md`.

### `data:` URL posture

`data:text/html` is blocked unconditionally. `data:image/svg+xml` is **conditional**, because the same value is inert in one sink and executable in another: fetched through an image sink (`<img src>`, `<image href>`, `<video poster>`/`src`, `<audio src>`, `<source src>`, the legacy `background` attribute) the browser decodes it in image mode where script never runs; loaded through a document sink (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`) it is parsed as a document and an `onload=` inside it fires.

So: **allowed for image-context sinks, blocked for document-context sinks, and blocked when the sink is unknown** — a call site that forgets to pass the element tag gets the strict answer.

`srcset` is deliberately not scheme-checked: its value is a comma-separated candidate list with descriptors that a single scheme test would mis-parse, and every candidate is fetched in image mode.

Verified by: `src/security/__tests__/url-safety.test.ts` > "allows data:image/svg+xml for image-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml for document-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml when no tag is supplied"

### Island props vs. RPC arguments — NOT equivalent

Both channels strip `__proto__`, `constructor` and `prototype`, and since DR-21 both do it at every depth; they differ only in where:

- **Island props** (inline `data-forma-props` and the shared `__forma_islands` block) are stripped **at every depth while they are parsed**, before any island sees them, with no opt-out. A nested pollution key never reaches an island, so a deep merge of its props (`createStore`, a deep-merge helper, an `Object.assign` chain) cannot carry one into a prototype. The pass is iterative with a `WeakSet`, so deep and cyclic payloads are safe. `sanitizePropsDeep(props)` stays exported for props that reach an island some other way.
- **RPC arguments** are sanitized **recursively, with no opt-in**, before the server function is invoked — iteratively, so a deeply nested body cannot overflow the stack.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "island activation strips forbidden keys at every depth, inline and shared, with no opt-out"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "island props nested 10,000 deep are parsed and stripped"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"
Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "strips forbidden keys at a depth that overflows a recursive walk"

### Store prototype-pollution guard

`createStore` refuses `__proto__`, `constructor` and `prototype` writes through both `setState` and the proxy's `set` trap, so untrusted JSON cannot replace the store's prototype and forge fields the app never defined.

**What is not covered:** `Object.setPrototypeOf(state, x)` and `Object.defineProperty(state, …)` have no traps and are not intercepted. Both are explicit API calls in your own code, not shapes a JSON payload can forge.

Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "setState with a __proto__ key does not replace the store prototype"
Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "assigning __proto__ directly on the proxy does not replace the prototype"

## RPC / server functions (`@getforma/core/server`)

Deprecated, and removed in 3.0.0 with server functions: serve the call from a
route in the application's Rust server ([STABILITY.md](docs/STABILITY.md#deprecated-entry-points)).

`handleRPC` executes registered `"use server"` functions. Its protections and their limits:

- **Argument sanitization**: RPC arguments are recursively stripped of `__proto__`, `constructor`, and `prototype` keys before the function is invoked, so a malicious payload cannot pollute `Object.prototype` even if the server function deep-merges its input. The walk is iterative, so a deeply nested body cannot overflow the stack and kill the process.
- **CSRF mitigation (`createRPCMiddleware`)**: requires the `X-Forma-RPC: 1` custom header (which forces a CORS preflight and cannot be attached by a cross-site HTML form) and a `application/json` content type. Requests missing either are rejected (403 / 415) before any function runs.
- **Error barrier**: `createRPCMiddleware` answers with a 500 rather than producing an unhandled promise rejection, which under Node's default `--unhandled-rejections=throw` would terminate the process.

  Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "degrades to 500 instead of rejecting when request handling throws"

- **Authorization is the deployment's responsibility.** `handleRPC` performs **no authentication or authorization by itself.** Install a guard — globally via `setRPCGuard((endpoint, args, ctx) => …)` or per call/middleware via the `authorize` option — to authenticate the caller and authorize the endpoint. Without a guard, any client that can reach the endpoint can invoke any registered function.

## Known gaps

Stated here rather than left for a reader to discover:

- **Streaming SSR under strict CSP.** `renderToStream` / `getSwapScript` / `getSwapTag` emit Suspense swap scripts **without a `nonce`**, so a strict `script-src 'nonce-…'` policy blocks them and out-of-order content never swaps in. Use non-streaming SSR under strict CSP. Do not add `'unsafe-inline'` as a workaround.
- **Island prop sanitization is shallow by default** — see above.
- **An expression is still code under T1** — the grammar bounds what it can reach, not the fact that it runs. See *Residual risks* above.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x | Yes |
| 1.5.x | Security fixes only |
| 1.1.x – 1.4.x | No — upgrade to 2.0 |
| 1.0.x | No — upgrade for the 1.1–2.0 correctness, security and RPC hardening |
| < 1.0 | No |
