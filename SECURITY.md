# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours and provide a fix timeline.

## Architecture & Trust Boundaries

FormaJS v1.0.0+ uses subpath exports to segment capabilities by trust level:

| Import | Capabilities | Trust Level |
|--------|-------------|-------------|
| `@getforma/core` | Signals, DOM, components, state, events, islands | No network, no eval, no filesystem — but see *Unsanitized HTML sinks* below |
| `@getforma/core/runtime` | HTML Runtime (data-* directives) | CSP-safe parser; `new Function` fallback present but **off** until opted in |
| `@getforma/core/runtime-hardened` | HTML Runtime (locked) | **No `new Function` in the artifact** — grepped by `scripts/verify-dist.mjs` |
| `@getforma/core/http` | `createFetch`, `createSSE`, `createWebSocket` | Network access (intentional) |
| `@getforma/core/storage` | `createLocalStorage`, `createIndexedDB` | Browser storage access (intentional) |
| `@getforma/core/server` | `$$serverFunction`, `handleRPC` | Network + `process.env` (server-side) |
| `@getforma/core/wasm` | `renderLocal`, `renderIsland` | Loads and instantiates a WASM module from `window.__FORMA_WASM__` |

The root entry's "no network" row is a real boundary, not a convention: `fetch`, `WebSocket` and the storage APIs live only behind their subpaths and are absent from the root barrel.

Verified by: `src/__tests__/index-surface.test.ts` > "does NOT export HTTP primitives (moved to @getforma/core/http)"
Verified by: `src/__tests__/index-surface.test.ts` > "does NOT export storage primitives (moved to @getforma/core/storage)"
Verified by: `src/__tests__/index-surface.test.ts` > "does NOT export server primitives (moved to @getforma/core/server)"

### Unsanitized HTML sinks

`h()` builds DOM with `document.createElement` and writes text with `textContent`; the library never parses a markup string of its own. Four APIs deliberately opt out. **None of them sanitizes**, and all four should be treated as first-party-content-only:

- `dangerouslySetInnerHTML={{ __html }}` — prop on `h()` / JSX; assigns `innerHTML`.
- `setHTMLUnsafe(el, html)` — exported from `@getforma/core`; assigns `innerHTML`.
- `reconcile(container, html)` — exported from `@getforma/core/runtime`; parses an HTML string into a `<template>` and diffs it into the live page.
- The `srcdoc` attribute — the browser parses the *attribute value* as a document, so attribute escaping does not neutralize it. It is emitted (a sandboxed `<iframe srcdoc>` is legitimate) with a dev-mode warning.

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "emits srcdoc but warns that escaping does not neutralize it"

## Supply Chain Security Notes

### `new Function` in the HTML Runtime

The HTML Runtime ships a `new Function()` fallback for expressions the CSP-safe parser cannot compile. **In every build it starts disabled** — source, `dist/runtime.js`, `dist/runtime.cjs`, both IIFE globals, and SSR/Node. It is reached only after an explicit opt-in:

- `setUnsafeEval(true)`, or
- `data-forma-unsafe-eval="true"` on the script tag that loads the runtime, or
- `window.__FORMA_RUNTIME_CONFIG = { allowUnsafeEval: true }`.

`isUnsafeEvalAllowed()` reports the live answer. Turning it on logs a one-time console warning, because the page then requires `'unsafe-eval'` in its CSP.

Verified by: `src/__tests__/runtime-csp-default.test.ts` > "every build ships with the new Function fallback disabled"

- **Hardened build (`runtime-hardened`)**: no `new Function` call sites at all. The build defines `__FORMA_UNSAFE_EVAL_MODE__` as `"locked-off"` and esbuild's syntax minification plus tsup's tree-shaking pass fold the branch away. `scripts/verify-dist.mjs` greps the built artifacts as the last step of `npm run build`, so this is asserted on the bytes that ship, not inferred.

  Verified by: `src/__tests__/build-artifacts.test.ts` > "hardened builds emit no new Function at all"
  Verified by: `src/__tests__/runtime-csp-default.test.ts` > "a locked-off build cannot be talked into eval by any configuration"

- **Standard build (`runtime`)**: `new Function` is present but unreachable until opted in. If the page CSP then blocks it, the runtime reports an accurate `EvalError` diagnostic and disables the fallback rather than silently evaluating expressions to `undefined`.

  Verified by: `src/__tests__/runtime-csp-default.test.ts` > "reports a CSP diagnostic and stops using new Function when the page CSP blocks it"

### The `with()` + Proxy wrapper is a blocklist, not a sandbox

Once the fallback is enabled, compiled expressions run inside `with (proxy) { … }`. **This does not confine them to your declared state.** The proxy's `has` trap answers `key in scope.getters`, so any identifier that is *not* a declared state key reports `false` and `with()` falls through to the real global scope: `document`, `fetch`, `localStorage`, `XMLHttpRequest` and everything else are reachable, and declared state can be passed to them.

What the wrapper *does* enforce is the `UNSAFE_METHOD_NAMES` blocklist — `constructor`, `__proto__`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `eval`, `Function` — at two layers: a static scan of the expression text before compilation (including computed bracket concatenation such as `x['constr' + 'uctor']`), and the proxy's `get` trap at runtime.

The correct threat model: **an expression in a `data-*` attribute is code, and must be treated exactly like a `<script>` you wrote yourself.** Never build one from user input. This unbounded reach is a second reason the fallback is opt-in, alongside the CSP requirement.

Verified by: `src/__tests__/unsafe-eval-scope.test.ts` > "reads a real global that was never declared as state"
Verified by: `src/__tests__/unsafe-eval-scope.test.ts` > "calls a real global function that was never declared as state"
Verified by: `src/__tests__/unsafe-eval-scope.test.ts` > "still blocks the UNSAFE_METHOD_NAMES blocklist on the same path"

### `fetch` in the HTTP module

`@getforma/core/http` uses the browser's native `fetch` API for `createFetch`, `createSSE`, and `createWebSocket`. This is opt-in — it is not included in the main `@getforma/core` entry point.

### `process.env` in the server module

`@getforma/core/server` reads `process.env.NODE_ENV` to determine whether to expose internal error messages in RPC responses (dev mode only). Production mode returns generic error messages.

### Published bundles are readable

All dist output is syntax-minified only: constant folding and dead-branch removal, with identifiers and line structure preserved. Nothing is mangled onto a single line, so supply-chain scanners do not see "obfuscated code". Syntax minification is what makes the build-time flags real — without it esbuild leaves `__DEV__` and the eval-capability constant as variables nothing folds, and the hardened artifact still contains `new Function`.

Verified by: `src/__tests__/build-config.test.ts` > "enables syntax minification everywhere so the build-time flags fold"

## Security Hardening (v0.5.0 – 1.5.0)

- **`$el` safe proxy** (0.7.0): The `$el` magic in the HTML Runtime is wrapped in a Proxy that allowlists safe DOM properties. Chains like `$el.ownerDocument.defaultView.setTimeout` are blocked.
- **`findBlockedMethod`** (0.7.0): Static analysis + runtime proxy defense-in-depth blocks `constructor`, `__proto__`, `eval`, `Function` access in expressions — including computed bracket concatenation (`x['constr' + 'uctor']`).
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
- **The unsafe-eval fallback does not confine expressions to declared state** — see above.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.5.x | Yes |
| 1.1.x – 1.4.x | Security fixes only |
| 1.0.x | No — upgrade for the 1.1–1.5 correctness and RPC hardening |
| < 1.0 | No |
