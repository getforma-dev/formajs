/**
 * Whether a CSS selector reads only the element it is tested against
 * (FORMA-128, L-36).
 *
 * `matches()`, `closest()`, `querySelector()` and `querySelectorAll()` take a
 * selector, and a selector is a read of whatever it names: `$el.matches(
 * '[data-email^="a"] *')` asks a question about an ANCESTOR, which under a
 * tiered mount may be the application's page outside the mount root. Asked
 * one character at a time, it reads an attribute value out. So a mount that
 * does not grant `dom` accepts only a LOCAL selector: a list of compound
 * selectors (type, `*`, `#id`, `.class`, `[attribute]` and pseudo-classes), with
 * no combinator (descendant, `>`, `+`, `~`), no pseudo-element, no namespace,
 * no nesting `&`, no `:host`, and of the functional pseudo-classes only
 * `:not()`, `:is()` and `:where()` (whose arguments are checked as part of the
 * whole) and the `:nth-*()` family over `An+B`. A local selector judges each
 * element by its own tag, attributes and state.
 *
 * Rationale, not a guarantee of this function: a few pseudo-classes reflect
 * state the element inherits (`:disabled` under a disabled `fieldset`,
 * `:read-write` under `contenteditable`) or its position among its siblings
 * (`:first-child`), so a local selector can still learn a bounded number of
 * bits about its surroundings, never an attribute's value or a text.
 *
 * The check fails closed: what it cannot classify, a malformed selector
 * included, is not local.
 *
 * Verified by: src/expr/__tests__/selector.test.ts > "accepts every local selector form"
 * Verified by: src/expr/__tests__/selector.test.ts > "refuses every selector that reads past the element"
 */

/** A CSS escape: up to six hex digits and one whitespace, or any one character. */
const ESCAPE = /\\(?:[0-9a-f]{1,6}[ \t\n\f\r]?|[\s\S])/gi;

/** An attribute selector, its quoted values included. */
const ATTRIBUTE = /\[(?:[^\]"'\\]|"[^"]*"|'[^']*')*\]/g;

/** `:nth-child(An+B)` and its family; never the `of <selector>` form, which is not local. */
const NTH = /:nth-(?:last-)?(?:child|of-type)\(\s*(?:odd|even|[+-]?\d*n(?:\s*[+-]\s*\d+)?|[+-]?\d+)\s*\)/gi;

/** The opening of a functional pseudo-class whose argument is a selector list. */
const LIST_OPEN = /:(?:not|is|where)\(/gi;

/**
 * Left after the rewrites below, what is not local: a pseudo-element, `:host`,
 * or any character a compound selector does not have, which takes in every
 * combinator (whitespace, `>`, `+`, `~`, `||`), a namespace `|`, nesting `&`,
 * and the `(` of any other function.
 */
const NOT_LOCAL = /::|:host\b|[^\w\-#.*:,\u0001)\u0080-\uffff]/i;

/** An empty compound: a leading, doubled or trailing comma, or an empty argument list. */
const EMPTY = /^,|[,\u0001],|,$|,\)|\u0001\)/;

/** Longest selector considered at all. */
const MAX_LENGTH = 1024;

/**
 * True when `selector` reads only the element it is tested against: see the
 * module comment for the grammar. Fails closed on anything else.
 */
export function isLocalSelector(selector: string): boolean {
  if (selector.length === 0 || selector.length > MAX_LENGTH) return false;
  const s = selector
    .replace(ESCAPE, 'a')
    .replace(ATTRIBUTE, 'a')
    .replace(NTH, '')
    .replace(LIST_OPEN, '\u0001')
    .replace(/\s*,\s*/g, ',')
    .replace(/\u0001\s+/g, '\u0001')
    .replace(/\s+\)/g, ')')
    .trim();
  if (s === '' || NOT_LOCAL.test(s) || EMPTY.test(s)) return false;
  // Every argument list opened is closed, and nothing closes what was not opened.
  let depth = 0;
  for (const c of s) {
    if (c === '\u0001') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}
