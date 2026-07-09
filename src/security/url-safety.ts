/**
 * URL / attribute safety helpers shared by the SSR renderer (`src/ssr`) and the
 * DOM runtime (`src/runtime.ts`).
 *
 * The subtle part is scheme detection. Browsers strip ASCII whitespace and C0
 * control characters out of a URL before resolving its scheme, so
 * `java\tscript:alert(1)`, `javas\ncript:...` and `\x01javascript:...` all
 * execute even though a naive `/^javascript:/` test does not match them. We
 * normalize the value the same way the browser does *before* testing.
 *
 * This module has no dependencies so it can be pulled into every build variant
 * (standard, hardened/CSP, SSR) cheaply.
 */

// C0 controls + space (0x00-0x20), DEL and C1 controls (0x7F-0x9F). These are
// exactly the bytes a URL parser ignores/strips when reading the scheme.
const URL_IGNORED_CHARS_RE = /[\u0000-\u0020\u007F-\u009F]/g;

// Schemes that can execute script or smuggle an active HTML document.
// Kept intentionally narrow to avoid blocking legitimate `data:image/*` inline
// assets; `data:image/svg+xml` in a navigable context is handled separately.
const DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data:text\/html)/i;

/** Attributes whose values are resolved as URLs and must be scheme-checked. */
export const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'background',
]);

/** True if `name` is a URL-bearing attribute (case-insensitive). */
export function isUrlAttr(name: string): boolean {
  return URL_ATTRS.has(name.toLowerCase());
}

/**
 * True if `value` uses a scheme that can execute script, after normalizing away
 * the whitespace and control characters that browsers ignore in a URL scheme.
 */
export function isDangerousUrl(value: string): boolean {
  const normalized = value.replace(URL_IGNORED_CHARS_RE, '');
  return DANGEROUS_SCHEME_RE.test(normalized);
}

/** True for any `on…` event-handler attribute name (case-insensitive). */
export function isEventHandlerAttr(name: string): boolean {
  return /^on/i.test(name);
}

// A well-formed HTML attribute name: starts with a letter/`_`/`:`, followed by
// letters, digits, `-`, `_`, `:` or `.`. Rejects whitespace, `=`, quotes and
// `/`, which is what an attacker needs to break out and inject a new attribute.
const SAFE_ATTR_NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/** True if `name` is safe to emit verbatim as an attribute name. */
export function isSafeAttrName(name: string): boolean {
  return SAFE_ATTR_NAME_RE.test(name);
}
