/**
 * Forma DOM - Namespaces
 *
 * Which namespace an element is created in, decided as the HTML parser decides
 * it for the server's markup (decision brief DR-9, FORMA-026): inside an SVG
 * element its content is SVG, inside a MathML element MathML, except at the
 * parser's HTML integration points, whose content is HTML.
 *
 * `h()` builds a child before its parent exists, so it cannot see where the
 * child goes. Two mechanisms close that gap:
 *
 * - **Context at build.** Where the parent is known (a reactive child, a
 *   control-flow branch rendered after insertion, a portal, `mount()`), the
 *   content is built inside {@link withNamespace} with the parent's content
 *   namespace, and `h()` creates the tags that are both HTML and SVG (`a`,
 *   `title`, `script`, `style`, `font`) in it.
 * - **Repair at insertion.** A node built before its parent was known carries a
 *   {@link NS_SYM} function. Where `h()` inserts it, the function receives the
 *   parent's content namespace and, if the node was built in another, rebuilds
 *   it (an element) or re-renders its content (a control-flow marker).
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * On a node built before its parent was known: called with the namespace of
 * the content it is being inserted into; returns the node that replaces it, or
 * null when it stays.
 */
export const NS_SYM = Symbol.for('forma-ns');

/** The namespace `h()` creates a dual-use tag in: null is HTML. */
let current: string | null = null;

/** @internal The namespace of the content being built (null: HTML). */
export function getNamespace(): string | null {
  return current;
}

/**
 * @internal Run `build` with `ns` as the namespace of the content being built
 * (null: HTML); `undefined` keeps the current one.
 */
export function withNamespace<T>(ns: string | null | undefined, build: () => T): T {
  if (ns === undefined || ns === current) return build();
  const prev = current;
  current = ns;
  try {
    return build();
  } finally {
    current = prev;
  }
}

/** MathML elements whose content the parser treats as HTML. */
const MATHML_TEXT_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

/**
 * The namespace the parser gives the content of `parent`: SVG inside an SVG
 * element and MathML inside a MathML element, except at the HTML integration
 * points (an SVG `foreignObject`, `desc` or `title`; a MathML `mi`, `mo`, `mn`,
 * `ms` or `mtext`; an `annotation-xml` whose `encoding` is HTML); null (HTML)
 * there and anywhere else.
 *
 * Verified by: src/dom/__tests__/namespace-resolution.test.ts > "keeps an a and a title in HTML outside an svg, and inside a foreignObject or a desc, even when built in svg()"
 * Verified by: src/dom/__tests__/namespace-resolution.test.ts > "h() creates math and its elements in the MathML namespace, and HTML inside a token element, as the parser does"
 */
export function contentNs(parent: Node | null | undefined): string | null {
  const el = parent as Element | null | undefined;
  const ns = el && el.namespaceURI;
  if (ns === SVG_NS) {
    const name = el!.localName;
    return name === 'foreignObject' || name === 'desc' || name === 'title' ? null : SVG_NS;
  }
  if (ns === MATHML_NS) {
    const name = el!.localName;
    return MATHML_TEXT_POINTS.has(name) ||
      (name === 'annotation-xml' && /^(text\/html|application\/xhtml\+xml)$/i.test(el!.getAttribute('encoding') ?? ''))
      ? null
      : MATHML_NS;
  }
  return null;
}

/**
 * @internal The namespace content inserted into `parent` is built in: the
 * parser's for an element, `undefined` (keep the current one) for a fragment,
 * whose eventual parent is not known yet.
 */
export function insertNs(parent: Node): string | null | undefined {
  return parent.nodeType === 1 ? contentNs(parent) : undefined;
}

/** False while a rebuild moves nodes it will settle itself afterwards. */
let settling = true;

/** @internal Run `move` without settling what it inserts. */
export function unsettled<T>(move: () => T): T {
  settling = false;
  try {
    return move();
  } finally {
    settling = true;
  }
}

/** Settle one node against `ns`: the node now in its place. */
function settleOne(node: Node, ns: string | null): Node {
  const fix = (node as { [NS_SYM]?: (ns: string | null) => Node | null })[NS_SYM];
  return (fix && fix(ns)) || node;
}

/**
 * @internal Before `child` is inserted into `parent`: if `parent` is an
 * element, rebuild or re-render what was built in another namespace than its
 * content's, and return the node to insert. A fragment is settled node by node
 * when its new parent is SVG or MathML content (HTML content is where it was
 * built, unless it was built inside `svg()`).
 */
export function settle(parent: Node, child: Node): Node {
  if (!settling || parent.nodeType !== 1) return child;
  if (child.nodeType === 11) {
    const ns = contentNs(parent);
    if (ns) for (let n = child.firstChild; n; n = settleOne(n, ns).nextSibling);
    return child;
  }
  return (child as { [NS_SYM]?: unknown })[NS_SYM] ? settleOne(child, contentNs(parent)) : child;
}

/** @internal Settle every child of `el` against its content namespace, in place. */
export function settleChildren(el: Element): void {
  const ns = contentNs(el);
  for (let n = el.firstChild; n; n = settleOne(n, ns).nextSibling);
}
