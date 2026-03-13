/**
 * Forma DOM - Template
 *
 * Runtime helper for compiled template output. Memoizes template parsing
 * so that each unique HTML string is parsed once and then cloned per use.
 *
 * The returned node should be cloned via `.cloneNode(true)` before use
 * in component instances.
 */

const cache = new Map<string, Node>();

/**
 * Create a reusable template node from an HTML string.
 *
 * The returned node is a cached prototype. Callers must call
 * `.cloneNode(true)` to get a unique DOM tree for each component instance.
 */
export function template(html: string): Node {
  let node = cache.get(html);
  if (!node) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    node = tpl.content.firstChild!;
    cache.set(html, node);
  }
  return node;
}

/**
 * Create a reusable template DocumentFragment from an HTML string.
 *
 * Used when the template has multiple root nodes. The returned fragment
 * is a cached prototype; callers must call `.cloneNode(true)`.
 */
export function templateMany(html: string): DocumentFragment {
  let node = cache.get(html);
  if (!node) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    node = tpl.content;
    cache.set(html, node);
  }
  return node.cloneNode(true) as DocumentFragment;
}
