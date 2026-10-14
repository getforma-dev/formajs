/**
 * isLocalSelector (FORMA-128, L-36): under a tiered mount without `dom`, a
 * selector given to matches(), closest() or querySelector(All)() must judge
 * each element on its own state, never ask about an ancestor or a sibling.
 *
 * Two-sided: the forms a widget uses to find its own elements are accepted
 * (the allow-list half), and every way of writing a question about another
 * element is refused, as is anything the scanner cannot classify.
 */
import { describe, expect, it } from 'vitest';
import { isLocalSelector } from '../selector';

/** Selectors that read only the element tested. */
const LOCAL: readonly string[] = [
  'div',
  '*',
  '#total',
  '.row',
  'li.row.active',
  'input[type="checkbox"]',
  "a[href^='/api/'] ",
  '[data-x="a]b,c"]',
  '[data-x="a\\"b"]',
  '[data-key]',
  '[lang|=en i]',
  'button:disabled',
  'input:checked',
  'li:first-child',
  'li:nth-child(2n+1)',
  'li:nth-of-type( odd )',
  'li:nth-last-child(-n + 3)',
  'tr:nth-child(4)',
  ':not(.done)',
  'li:is(.a, .b):where([data-x])',
  ':not(:is(.a, :not(.b)))',
  '.md\\:flex',
  '.\\31 23',
  '.café',
  'p, span , .x',
  ':not(:not(:not(:not(:not(:not(:not(:not(:not(.x)))))))))',
  'LI:NOT(.done):NTH-CHILD(2N+1)',
  '  .padded  ',
];

/** Selectors that read past the element tested, or that cannot be classified. */
const NOT_LOCAL: readonly string[] = [
  'body .row', // descendant combinator: an ancestor
  'div > p',
  'h1 + p', // a previous sibling
  'h1 ~ p',
  '[data-email^="a"] *',
  '.row, body *', // the second of a list
  ':is(body *)', // an ancestor inside a local-looking function
  ':not(.admin *)',
  ':where(main > *)',
  ':has(+ .x)', // a following sibling
  ':has(.x)',
  'li:nth-child(2 of .x)', // `of` filters siblings by a selector
  ':host',
  ':host(.x)',
  ':host-context(.dark)',
  ':lang(en)', // inherited from an ancestor
  ':dir(rtl)',
  'p::before', // a pseudo-element
  'svg|rect', // a namespace
  '*|*',
  '& .x', // nesting
  '',
  ',',
  '.a,',
  'div .',
  '[unclosed',
  '[a=]b]',
  ':not(.x',
  ':nth-child(n',
  ':unknown-function(x)',
  'a {}',
  '.x)', // closes what it did not open
  '.x):not(.y', // ...and opens it again after
  ':not()', // an empty argument
  ':is(.a,)',
  `.${'x'.repeat(1100)}`, // longer than any selector considered
];

describe('isLocalSelector', () => {
  it('accepts every local selector form', () => {
    const refused = LOCAL.filter((s) => !isLocalSelector(s));
    expect(refused).toEqual([]);
  });

  it('refuses every selector that reads past the element', () => {
    const accepted = NOT_LOCAL.filter((s) => isLocalSelector(s));
    expect(accepted).toEqual([]);
  });

  it('a combinator anywhere refuses the whole list, whatever its neighbours', () => {
    for (const combinator of [' ', ' > ', '>', ' + ', '+', ' ~ ', '~']) {
      expect(isLocalSelector(`.a${combinator}.b`), JSON.stringify(combinator)).toBe(false);
      expect(isLocalSelector(`.ok, .a${combinator}.b`), JSON.stringify(combinator)).toBe(false);
      expect(isLocalSelector(`:not(.a${combinator}.b)`), JSON.stringify(combinator)).toBe(false);
    }
    // And the same compounds without the combinator are local.
    expect(isLocalSelector('.a.b')).toBe(true);
    expect(isLocalSelector('.ok, .a')).toBe(true);
    expect(isLocalSelector(':not(.a.b)')).toBe(true);
  });
});
