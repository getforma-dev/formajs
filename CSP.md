# FormaJS & Content Security Policy (CSP)

FormaJS needs no `unsafe-inline` and no `unsafe-eval`, in **any** build. There is no switch that could change that: expressions in `data-*` attributes are evaluated by an allowlist AST interpreter, and **no shipped artifact contains `eval`, `new Function` or `with()`**. The opt-in fallback that used to exist has been deleted, not disabled.

The flagship example in [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md) — arrow-function callback and all — is served in CI under a real `Content-Security-Policy: script-src 'self'` response header, and the browser console is asserted to report zero violations.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by `src/__tests__/runtime-csp-default.test.ts` > "never constructs a function, not even one that would have succeeded"
Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

---

## How It Works

Strict CSP headers block inline styles and scripts unless they carry a nonce:

```
style-src 'nonce-abc123' 'self';
script-src 'nonce-abc123' 'self';
```

FormaJS handles this in two ways:

**Scripts:** `<script>` tags rendered by `forma-server`'s page renderer include a `nonce` attribute. No inline event handlers are used — FormaJS attaches events via `addEventListener`, and an `on*` attribute is dropped in any casing on both the client and SSR paths.

Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"

> **Streaming SSR caveat:** the JS streaming renderer's Suspense swap scripts (`renderToStream` / `getSwapScript` / `getSwapTag`) are emitted **without** a `nonce` — the functions take no nonce parameter at all — so under a strict `script-src 'nonce-…'` policy they are blocked and out-of-order Suspense content will not swap in. Until nonce threading lands, either use non-streaming SSR under strict CSP, or allow these scripts explicitly. Do not add `'unsafe-inline'` as a workaround.
>
> Verified by `src/__tests__/docs-truth.test.ts` > "the streaming swap scripts really do lack a nonce, as the caveat says"

**Styles:** The `h()` function applies styles via the CSSOM API (`Object.assign(el.style, ...)`) instead of `el.style.cssText` or `setAttribute('style', ...)`. CSSOM property assignment is not blocked by CSP — only string-based style injection is.

---

## Style Patterns — All CSP-Safe

```typescript
// Object style (always worked)
h('div', { style: { color: 'red', fontSize: '14px' } })

// String style (CSP-safe since v1.0.9)
// Internally parsed into individual properties via CSSOM
h('div', { style: 'color: red; font-size: 14px' })

// Reactive object style
h('div', { style: () => ({ borderColor: active() ? '#6366f1' : '#333' }) })

// Reactive string style
h('div', { style: () => `border-top: 3px solid ${color()}` })
```

All four patterns work under strict CSP. Internally, string styles are parsed by `parseCssString()` into property objects, then applied via `Object.assign(el.style, ...)`.

---

## What CSP Blocks (and FormaJS Avoids)

| Technique | Blocked by CSP? | FormaJS uses it? |
|-----------|-----------------|-------------------|
| `el.style.cssText = '...'` | Yes (`style-src` without `unsafe-inline`) | **No** — removed in v1.0.9 |
| `el.setAttribute('style', '...')` | Yes | **No** |
| `innerHTML` with `style="..."` | Yes | **Not for library-generated markup** — `h()` builds DOM with `createElement`/`textContent`. `innerHTML` is reached only through the explicit opt-in sinks: `dangerouslySetInnerHTML`, `setHTMLUnsafe()` and `reconcile()`. See [SECURITY.md](./SECURITY.md#unsanitized-html-sinks). |
| `Object.assign(el.style, {...})` | No (CSSOM API) | **Yes** — all styles go through this |
| `el.style.color = 'red'` | No (CSSOM API) | **Yes** (via Object.assign) |
| `new Function(...)` | Yes (`script-src` without `unsafe-eval`) | **No** — an allowlist AST interpreter is used instead, in every build. There is no opt-in and no fallback; `scripts/verify-dist.mjs` greps every published artifact. |
| `eval(...)` | Yes (`script-src` without `unsafe-eval`) | **No** — same gate. |
| `with (scope) { … }` | No, but it defeats scope isolation | **No** — removed with the evaluator that used it. See [SECURITY.md](./SECURITY.md#why-an-allowlist-and-what-the-blocklist-it-replaced-could-not-do). |

---

## Common Issues

### "Applying inline style violates CSP directive"

**Cause:** Using a version of FormaJS before v1.0.9 that still uses `el.style.cssText`.

**Fix:** Update `@getforma/core` to v1.0.9+.

### "Refused to execute inline script"

**Cause:** A `<script>` tag is missing its `nonce` attribute. This happens if you inject scripts via `innerHTML`, create them with `document.createElement('script')` without setting the nonce, or use streaming SSR (see the caveat above).

**Fix:** Use `forma-server`'s `render_page()` which automatically injects nonces on all script tags. If you need to add custom scripts, use the `config_script` field in `PageConfig` — it's rendered inside a nonce-tagged script block.

### "Refused to apply inline style" on `<style>` tags

**Cause:** A `<style>` tag is missing its `nonce` attribute. `forma-server`'s `render_page()` adds nonces to the personality CSS `<style>` tag automatically. If you create `<style>` elements in JavaScript, they won't have nonces.

**Fix:** Use CSS classes instead of dynamic `<style>` injection. Or use `el.style.property = value` (CSSOM) which is not blocked.

### "An expression rendered nothing and the console says `data-forma-expr-error`"

**Cause:** The expression is outside the grammar, or it named something the allowlist does not offer. It was **not** evaluated, by design — the binding left the DOM alone rather than writing an empty string.

The `console.error` beside the attribute names the cause with a stable code and a column: `FORMA_E_SYNTAX` (the parser refused the text), `FORMA_E_UNRESOLVED` (an identifier that is not state, not a magic and not one of the frozen namespaces — `document`, `window` and `fetch` land here), `FORMA_E_METHOD_DENIED` / `FORMA_E_PROPERTY_DENIED` (not on the allowlist for that receiver), `FORMA_E_KEY_DENIED` (`constructor`, `__proto__`, `call`, …), `FORMA_E_ASSIGN_DENIED` (unknown or read-only target), `FORMA_E_LIMIT` / `FORMA_E_BUDGET` (a parse or evaluation budget).

**Fix:** Rewrite it within the grammar (see [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md), *The expression grammar is an allowlist, not a blocklist*) or precompute the value server-side. There is no fallback to opt into: adding `'unsafe-eval'` to your policy will not make it run, because FormaJS has no code path that would use it. Call `getDiagnostics()` for the full list, or listen for the `formajs:diagnostic` event.

---

## Server Configuration (forma-server)

`forma-server` generates strict CSP headers automatically via `build_csp_header()`:

```
default-src 'none';
script-src 'nonce-{random}' 'self';
style-src 'nonce-{random}' 'self';
connect-src 'self';
img-src 'self' data:;
font-src 'self';
frame-ancestors 'none';
base-uri 'none';
form-action 'self'
```

Every page render generates a unique cryptographic nonce. Scripts and the personality `<style>` tag get this nonce. Everything else must come from `'self'` (same origin).

**This header is satisfied by every build.** The hardened artifact is no longer a stronger guarantee — it is the same runtime, bundled without code splitting — so pick either on size and packaging grounds alone.

**Do not add `unsafe-inline` or `unsafe-eval`.** FormaJS is designed to work without them.

Note that `img-src 'self' data:` above permits `data:` images. FormaJS matches that posture: `data:image/svg+xml` is allowed only for image-context sinks (`<img src>`, `<video poster>`, …) and blocked for document-context sinks (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`), where the browser would parse it as a document and run script inside it.

Verified by `src/security/__tests__/url-safety.test.ts` > "allows data:image/svg+xml for image-context sinks"
Verified by `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml for document-context sinks"

---

## Testing CSP

Check the browser console for CSP violations. They appear as:

```
Refused to apply inline style because it violates the following
Content Security Policy directive: "style-src 'nonce-...' 'self'"
```

If you see this with FormaJS v1.0.9+, the issue is outside FormaJS — check for:
- `innerHTML` containing `style="..."` attributes
- `el.style.cssText = '...'` in non-FormaJS code
- Third-party libraries that inject inline styles

---

## Version History

The last row carries the same label as `CHANGELOG.md`'s `## [Unreleased]`
heading, and moves to a version number when that entry does. A test pins both
ends of that rule: the newest row says `Unreleased`, and the row below it ends
at the version in `package.json`.

Verified by `src/__tests__/docs-truth.test.ts` > "CSP.md's version history ends at the shipped version, then Unreleased"

| Version | CSP Status |
|---------|------------|
| < 1.0.9 | String styles use `cssText` — **requires `unsafe-inline` in `style-src`** |
| 1.0.9 – 1.5.0 | All styles use CSSOM. Scripts need no `unsafe-inline`, **but the standard runtime shipped with the `new Function` fallback ENABLED**, so any expression outside the regex parser's grammar silently evaluated to `undefined` under a policy without `unsafe-eval`. |
| 2.0.0 | The regex parser and the fallback are **deleted**. Every build evaluates expressions with an allowlist AST interpreter — arrow-function callbacks, object literals, `$event`, bare method-call handlers and the frozen `Math`/`JSON`/`Object`/`Array` namespaces all run with no `unsafe-eval` — and anything outside the grammar is reported with a code and a column instead of silently dropped. **Fully CSP-safe, no `unsafe-inline` and no `unsafe-eval`, with nothing left to misconfigure.** |
| 2.0.1 | No CSP-affecting changes since 2.0.0. |
| Unreleased | No CSP-affecting changes since 2.0.1. |
