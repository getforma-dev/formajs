/**
 * Forma DOM - Template
 *
 * Runtime helper for compiled template output. Memoizes template parsing
 * so that each unique HTML string is parsed once and then cloned per use.
 *
 * The returned node should be cloned via `.cloneNode(true)` before use
 * in component instances.
 */

import { rawHtml, type TrustedHtml } from './trusted-html.js';

const cache = new Map<string, Node>();

/**
 * Create a reusable template node from markup. A raw sink: the markup is
 * parsed as it is, unescaped, so pass `trustedHtml()` (DR-19); a plain string
 * still works in 2.x and warns once in development (FORMA_W_RAW_TEMPLATE).
 *
 * The returned node is a cached prototype. Callers must call
 * `.cloneNode(true)` to get a unique DOM tree for each component instance.
 */
export function template(html: string | TrustedHtml): Node {
  const markup = String(html);
  let node = cache.get(markup);
  if (!node) {
    const tpl = document.createElement('template');
    tpl.innerHTML = rawHtml(html, 'template');
    node = tpl.content.firstChild!;
    cache.set(markup, node);
  }
  return node;
}

/**
 * Create a reusable template DocumentFragment from markup, a raw sink as
 * {@link template} is.
 *
 * Used when the template has multiple root nodes. The returned fragment
 * is a cached prototype; callers must call `.cloneNode(true)`.
 */
export function templateMany(html: string | TrustedHtml): DocumentFragment {
  const markup = String(html);
  let node = cache.get(markup);
  if (!node) {
    const tpl = document.createElement('template');
    tpl.innerHTML = rawHtml(html, 'template');
    node = tpl.content;
    cache.set(markup, node);
  }
  return node.cloneNode(true) as DocumentFragment;
}
