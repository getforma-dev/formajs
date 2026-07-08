# FormaJS & Content Security Policy (CSP)

FormaJS is CSP-safe by default. No `unsafe-inline` or `unsafe-eval` required.

---

## How It Works

Strict CSP headers block inline styles and scripts unless they carry a nonce:

```
style-src 'nonce-abc123' 'self';
script-src 'nonce-abc123' 'self';
```

FormaJS handles this in two ways:

**Scripts:** `<script>` tags rendered by `forma-server`'s page renderer include a `nonce` attribute. No inline event handlers are used — FormaJS attaches events via `addEventListener`.

> **Streaming SSR caveat:** the JS streaming renderer's Suspense swap scripts (`renderToStream` / `getSwapScript` / `getSwapTag`) are currently emitted **without** a `nonce`, so under a strict `script-src 'nonce-…'` policy they are blocked and out-of-order Suspense content will not swap in. Until nonce threading lands (tracked for a follow-up release), either use non-streaming SSR under strict CSP, or allow these scripts explicitly. Do not add `'unsafe-inline'` as a workaround.

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
| `innerHTML` with `style="..."` | Yes | **No** |
| `Object.assign(el.style, {...})` | No (CSSOM API) | **Yes** — all styles go through this |
| `el.style.color = 'red'` | No (CSSOM API) | **Yes** (via Object.assign) |
| `new Function(...)` | Yes (`script-src` without `unsafe-eval`) | **No** — CSP-safe expression parser used instead |

---

## Common Issues

### "Applying inline style violates CSP directive"

**Cause:** Using a version of FormaJS before v1.0.9 that still uses `el.style.cssText`.

**Fix:** Update `@getforma/core` to v1.0.9+.

### "Refused to execute inline script"

**Cause:** A `<script>` tag is missing its `nonce` attribute. This happens if you inject scripts via `innerHTML` or create them with `document.createElement('script')` without setting the nonce.

**Fix:** Use `forma-server`'s `render_page()` which automatically injects nonces on all script tags. If you need to add custom scripts, use the `config_script` field in `PageConfig` — it's rendered inside a nonce-tagged script block.

### "Refused to apply inline style" on `<style>` tags

**Cause:** A `<style>` tag is missing its `nonce` attribute. `forma-server`'s `render_page()` adds nonces to the personality CSS `<style>` tag automatically. If you create `<style>` elements in JavaScript, they won't have nonces.

**Fix:** Use CSS classes instead of dynamic `<style>` injection. Or use `el.style.property = value` (CSSOM) which is not blocked.

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

**Do not add `unsafe-inline` or `unsafe-eval`.** FormaJS is designed to work without them.

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

| Version | CSP Status |
|---------|------------|
| < 1.0.9 | String styles use `cssText` — **requires `unsafe-inline` in `style-src`** |
| >= 1.0.9 | All styles use CSSOM — **fully CSP-safe, no `unsafe-inline` needed** |
