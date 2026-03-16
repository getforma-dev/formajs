# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours and provide a fix timeline.

## Architecture & Trust Boundaries

FormaJS v1.0.0+ uses subpath exports to segment capabilities by trust level:

| Import | Capabilities | Trust Level |
|--------|-------------|-------------|
| `@getforma/core` | Signals, DOM, components, state, events, islands | **No network, no eval, no filesystem** |
| `@getforma/core/runtime` | HTML Runtime (data-* directives) | CSP-safe parser; optional unsafe-eval fallback |
| `@getforma/core/runtime-hardened` | HTML Runtime (locked) | **Zero `new Function`, zero eval — verified by DCE** |
| `@getforma/core/http` | `createFetch`, `createSSE`, `createWebSocket` | Network access (intentional) |
| `@getforma/core/storage` | `createLocalStorage`, `createIndexedDB` | Browser storage access (intentional) |
| `@getforma/core/server` | `$$serverFunction`, `handleRPC` | Network + `process.env` (server-side) |

## Supply Chain Security Notes

### `new Function` in standard runtime builds

The standard HTML Runtime (`@getforma/core/runtime`) includes a `new Function()` fallback for complex expressions that the CSP-safe parser cannot handle. This is gated behind `_allowUnsafeEval` which defaults to `false` in the hardened build.

- **Hardened build (`runtime-hardened`)**: Zero `new Function` calls. Verified by compile-time dead code elimination — the `__EVAL_CAPABLE__` constant folds to `false` and esbuild removes the entire code path.
- **Standard build (`runtime`)**: `new Function` is present but only reached when `_allowUnsafeEval` is explicitly enabled. It is sandboxed via a `with()` + `Proxy` wrapper that blocks access to `constructor`, `__proto__`, `eval`, `Function`, and other dangerous properties.

### `fetch` in the HTTP module

`@getforma/core/http` uses the browser's native `fetch` API for `createFetch`, `createSSE`, and `createWebSocket`. This is opt-in — it is not included in the main `@getforma/core` entry point.

### `process.env` in the server module

`@getforma/core/server` reads `process.env.NODE_ENV` to determine whether to expose internal error messages in RPC responses (dev mode only). Production mode returns generic error messages.

### IIFE builds are not minified

The CDN global builds (`formajs-runtime.global.js`, etc.) ship as readable, unminified code. This is intentional — minified single-line files trigger false-positive "obfuscated code" flags in supply chain scanners. CDNs serve with gzip/brotli compression, so the wire size impact is negligible.

## Security Hardening (v0.5.0 – v1.0.0)

- **`$el` safe proxy**: The `$el` magic in the HTML Runtime is wrapped in a Proxy that allowlists safe DOM properties. Chains like `$el.ownerDocument.defaultView.setTimeout` are blocked.
- **`findBlockedMethod`**: Static analysis + runtime proxy defense-in-depth blocks `constructor`, `__proto__`, `eval`, `Function` access in expressions — including computed bracket concatenation (`x['constr' + 'uctor']`).
- **SSR `escapeAttr`**: Escapes `<`, `>`, `'`, `"`, `&`. Blocks `javascript:`, `vbscript:`, and `data:text/html` URIs in `href`/`src`/`action`/`formaction` attributes.
- **SSR swap script**: `JSON.stringify` output escapes `<` as `\u003c` to prevent `</script>` injection in Suspense streaming.
- **Island props sanitized**: `JSON.parse` output stripped of `__proto__`, `constructor`, `prototype` keys.
- **CSP parser operator precedence**: Fixed to match JavaScript semantics (addition before comparison, AND before OR).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x | Yes |
| < 1.0 | No |
