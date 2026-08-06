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
| `@getforma/core/server` | `$$serverFunction`, `handleRPC` | Network + `process.env` (server-side) |
| `@getforma/core/wasm` | `renderLocal`, `renderIsland` | Loads and instantiates a WASM module from `window.__FORMA_WASM__` |

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

The language has no loops, no recursion, no generators and no way to name or store a function, so **every expression terminates by construction** — an arrow is legal only in the callback slot of nine allowlisted array methods, and cannot be assigned, stored, returned or re-invoked. Budgets therefore bound *cost*, not hanging: 4,096 source characters, 512 AST nodes, depth 32, arrow nesting 2, four call arguments, and a 100,000-step evaluation budget configurable per page with `data-forma-expr-budget` on the script tag. Argument-driven allocations are capped before the call (`repeat` ≤ 10,000, `flat` depth ≤ 8, strings ≤ 1 MiB, arrays ≤ 1,000,000).

Verified by: `src/expr/__tests__/adversarial.test.ts` > "a nested callback over a large array trips the step budget"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "an argument that would allocate hundreds of megabytes is refused"

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

## Security Hardening (v0.5.0 – 1.5.0)

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

Both channels strip `__proto__`, `constructor` and `prototype`, but to different depths, deliberately:

- **Island props** (inline `data-forma-props` and the shared `__forma_islands` block) are sanitized **shallowly** — top-level keys only. A pollution key nested inside a child object reaches your island. A deep walk of every payload on every hydration is a cost no island should pay by default. Export `sanitizePropsDeep(props)` from `@getforma/core` and call it yourself before handing props to anything that merges them (`createStore`, a deep-merge helper, an `Object.assign` chain). It is iterative with a `WeakSet`, so deep and cyclic payloads are safe.
- **RPC arguments** are sanitized **recursively, with no opt-in**, before the server function is invoked — iteratively, so a deeply nested body cannot overflow the stack.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "is opt-in: island activation still sanitizes only the top level"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"
Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "strips forbidden keys at a depth that overflows a recursive walk"

### Store prototype-pollution guard

`createStore` refuses `__proto__`, `constructor` and `prototype` writes through both `setState` and the proxy's `set` trap, so untrusted JSON cannot replace the store's prototype and forge fields the app never defined.

**What is not covered:** `Object.setPrototypeOf(state, x)` and `Object.defineProperty(state, …)` have no traps and are not intercepted. Both are explicit API calls in your own code, not shapes a JSON payload can forge.

Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "setState with a __proto__ key does not replace the store prototype"
Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "assigning __proto__ directly on the proxy does not replace the prototype"

## RPC / server functions (`@getforma/core/server`)

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
| 1.5.x | Yes |
| 1.1.x – 1.4.x | Security fixes only |
| 1.0.x | No — upgrade for the 1.1–1.5 correctness and RPC hardening |
| < 1.0 | No |
