/**
 * Forma DOM - Namespaces
 *
 * Which namespace an element is created in, decided as the HTML parser decides
 * it for the server's markup (decision brief DR-9, FORMA-026): inside an SVG
 * element its content is SVG, inside a MathML element MathML, except at the
 * parser's HTML integration points, whose content is HTML.
 *
 * `h()` creates the SVG and MathML names it knows in their namespace wherever
 * they appear. A tag that is both HTML and SVG (`a`, `title`, `script`,
 * `style`, `font`) takes the namespace of the content being built
 * ({@link withNamespace}): where the parent is known (a reactive child, a
 * control-flow helper's renders once its markers are in an element, a portal,
 * `mount()`, adoption) that is the parent's content namespace; inside `svg()`
 * it is SVG. A child passed to h() is built before its parent exists, so it
 * gets the namespace being built in then: HTML, unless the tree is inside
 * `svg()`.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

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
 * Verified by: src/dom/__tests__/namespace-resolution.test.ts > "a foreignObject's or desc's content is HTML when built there: an eager child, a reactive child, and content built outside svg()"
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
