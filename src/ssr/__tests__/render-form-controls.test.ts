/**
 * What `renderToString` writes for a `textarea` and a `select` (FORMA-017).
 *
 * forma-ir 0.2.1 (FORMA-002) writes a textarea's value as its text and a
 * select's value as `selected` on the matching option, which is where the HTML
 * parser reads them. `./ssr`'s renderer still writes both as a `value`
 * attribute, which the parser ignores, so the two server renderers disagree
 * until `./ssr` is removed in 3.0.0 (decision brief DR-24). The decision for
 * 2.x is to document the difference, not to change this renderer; these tests
 * pin what the documentation says.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderToString, sh } from '../render.js';
import { h } from '../../dom/element';
import { mount } from '../../dom/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

const options = () => [sh('option', { value: 'a' }, 'A'), sh('option', { value: 'b' }, 'B')];

describe('renderToString and form controls', () => {
  it("writes a textarea's and a select's value prop as a value attribute, static or reactive", () => {
    expect(renderToString(sh('textarea', { name: 't', value: 'Saved' }))).toBe('<textarea name="t" value="Saved"></textarea>');
    expect(renderToString(sh('textarea', { name: 't', value: () => 'Saved' }))).toBe('<textarea name="t" value="Saved"></textarea>');
    expect(renderToString(sh('select', { name: 's', value: 'b' }, ...options())))
      .toBe('<select name="s" value="b"><option value="a">A</option><option value="b">B</option></select>');
    expect(renderToString(sh('select', { name: 's', value: () => 'b' }, ...options())))
      .toBe('<select name="s" value="b"><option value="a">A</option><option value="b">B</option></select>');
    // What to write instead: a textarea's children are its text, with no
    // hydration marker, and `selected: true` is a bare attribute, as forma-ir
    // writes them.
    expect(renderToString(sh('textarea', { name: 't' }, () => 'Saved'))).toBe('<textarea name="t">Saved</textarea>');
    expect(renderToString(sh('select', { name: 's' }, sh('option', { value: 'a' }, 'A'), sh('option', { value: 'b', selected: true }, 'B'))))
      .toBe('<select name="s"><option value="a">A</option><option value="b" selected>B</option></select>');
  });

  it('the parsed page shows an empty textarea and the first option until adoption writes the values', () => {
    document.body.innerHTML = `<div id="app" data-forma-ssr>${renderToString(sh('form', null,
      sh('textarea', { name: 't', value: 'Saved' }),
      sh('select', { name: 's', value: 'b' }, ...options()),
    ))}</div>`;
    const textarea = document.querySelector('textarea')!;
    const select = document.querySelector('select')!;
    expect(textarea.value).toBe('');
    expect(select.value).toBe('a');

    mount(() => h('form', null,
      h('textarea', { name: 't', value: () => 'Saved' }),
      h('select', { name: 's', value: () => 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    ), '#app');

    expect(document.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('Saved');
    expect(select.value).toBe('b');
  });
});
