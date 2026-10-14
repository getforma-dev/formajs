/**
 * Fragments in adoption (FORMA-003, decision brief DR-7 (a)).
 *
 * A JSX Fragment has no element of its own: the server renders its children in
 * place. Before this fix `h(Fragment)` built a detached DocumentFragment even
 * while hydrating, and hydrateIsland treated that non-descriptor as success:
 * it removed data-forma-ssr, adopted nothing, and the page stayed inert. These
 * tests adopt Fragments at a mount() root, at an island root, nested inside an
 * element and as a show branch, and pin that a value adoption cannot match is
 * a failure, not a silent success.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { h, Fragment, fragment } from '../element';
import { mount } from '../mount';
import { activateIslands } from '../activate';
import { createShow } from '../show';
import { hydrateIsland } from '../hydrate';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Server HTML for the verification run 1 page: a root Fragment. */
function serverPage(): HTMLElement {
  document.body.innerHTML =
    '<div id="app" data-forma-ssr><span id="note"><!--f:t0-->hello<!--/f:t0--></span><button id="go">go</button></div>';
  return document.getElementById('app')!;
}

describe('Fragment adoption', () => {
  it('a root Fragment binds its click handler and reactive text after mount() adoption', () => {
    const app = serverPage();
    const span = document.getElementById('note')!;
    const button = document.getElementById('go')!;
    const [note, setNote] = createSignal('hello');

    const unmount = mount(() => h(Fragment, null,
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote('bye') }, 'go'),
    ), app);

    // Adopted in place: the server's nodes, not new ones.
    expect(document.getElementById('note')).toBe(span);
    expect(document.getElementById('go')).toBe(button);
    expect(app.hasAttribute('data-forma-ssr')).toBe(false);
    expect(span.textContent).toBe('hello');

    button.click();
    expect(span.textContent).toBe('bye');
    setNote('again');
    expect(span.textContent).toBe('again');
    button.click();
    expect(span.textContent).toBe('bye');
    expect(app.querySelectorAll('span')).toHaveLength(1);

    unmount();
  });

  it('the fragment() helper is adopted like a JSX Fragment', () => {
    const app = serverPage();
    const span = document.getElementById('note')!;
    const [note, setNote] = createSignal('hello');

    mount(() => fragment(
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote('bye') }, 'go'),
    ), app);

    document.getElementById('go')!.click();
    expect(span.textContent).toBe('bye');
    expect(app.childNodes).toHaveLength(2);
  });

  it('a Fragment at an island root is adopted, each island on its own', () => {
    document.body.innerHTML = [0, 1].map((id) =>
      `<div data-forma-island="${id}" data-forma-component="Pair">` +
      `<span class="n"><!--f:t0-->${id}<!--/f:t0--></span><button class="inc">+</button></div>`,
    ).join('');

    activateIslands({
      Pair: (el) => {
        const [n, setN] = createSignal(Number(el.getAttribute('data-forma-island')));
        return h(Fragment, null,
          h('span', { class: 'n' }, () => String(n())),
          h('button', { class: 'inc', onClick: () => setN(n() + 10) }, '+'),
        );
      },
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    const text = () => islands.map((i) => i.querySelector('.n')!.textContent);
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['active', 'active']);
    expect(text()).toEqual(['0', '1']);

    islands[0]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(text()).toEqual(['10', '1']);
    islands[1]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(text()).toEqual(['10', '11']);
    islands[0]!.querySelector<HTMLButtonElement>('.inc')!.click();
    expect(text()).toEqual(['20', '11']);
    expect(islands.map((i) => i.querySelectorAll('span').length)).toEqual([1, 1]);
  });

  it('a nested Fragment is adopted in place and the siblings after it stay aligned', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><section><b>a</b><!--f:t0-->x<!--/f:t0--><i>c</i><button>go</button></section></div>';
    const app = document.getElementById('app')!;
    const section = app.querySelector('section')!;
    const bold = section.querySelector('b')!;
    const button = section.querySelector('button')!;
    const [label, setLabel] = createSignal('x');
    const [clicks, setClicks] = createSignal(0);

    mount(() => h('section', null,
      h(Fragment, null,
        h('b', { onClick: () => setLabel('from b') }, 'a'),
        () => label(),
        h(Fragment, null, h('i', null, 'c')),
      ),
      h('button', { onClick: () => setClicks(clicks() + 1) }, () => `go ${clicks()}`),
    ), app);

    // The button after the Fragment is still the server's, and bound.
    expect(section.querySelector('button')).toBe(button);
    button.click();
    expect(button.textContent).toBe('go 1');
    bold.click();
    expect(section.textContent).toBe('afrom bcgo 1');
    setLabel('y');
    expect(section.textContent).toBe('aycgo 1');
    expect(section.children).toHaveLength(3);
  });

  it('a Fragment branch of createShow is adopted between the show markers', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><div><!--f:s0--><span>one</span><button>off</button><!--/f:s0--></div></div>';
    const app = document.getElementById('app')!;
    const serverButton = app.querySelector('button')!;
    const [open, setOpen] = createSignal(true);

    mount(() => h('div', null,
      createShow(open,
        () => h(Fragment, null, h('span', null, 'one'), h('button', { onClick: () => setOpen(false) }, 'off')),
        () => h('em', null, 'closed'),
      ),
    ), app);

    serverButton.click();
    expect(app.querySelector('em')?.textContent).toBe('closed');
    expect(app.querySelector('span')).toBeNull();
    setOpen(true);
    expect(app.querySelector('span')?.textContent).toBe('one');
    app.querySelector('button')!.click();
    expect(app.querySelector('em')?.textContent).toBe('closed');
  });

  it('a tag mismatch rebuilds a Fragment child from its descriptor', () => {
    document.body.innerHTML = '<div id="app" data-forma-ssr><p>stale</p></div>';
    const app = document.getElementById('app')!;
    const [count, setCount] = createSignal(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mount(() => h('section', null,
      h(Fragment, null, h('button', { onClick: () => setCount(count() + 1) }, () => `n=${count()}`)),
    ), app);
    warn.mockRestore();

    const button = app.querySelector('section > button') as HTMLButtonElement;
    expect(app.querySelector('p')).toBeNull();
    expect(button.textContent).toBe('n=0');
    button.click();
    expect(button.textContent).toBe('n=1');
  });

  it('a component that returns a DOM node while hydrating fails instead of reporting success', () => {
    const app = serverPage();
    const before = app.innerHTML;

    expect(() => hydrateIsland(() => document.createElement('span'), app)).toThrow(/cannot be adopted/);
    // Not claimed as adopted: the marker stays and the server DOM is untouched.
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(app.innerHTML).toBe(before);

    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Bad"><span>x</span></div>' +
      '<div data-forma-island="1" data-forma-component="Good"><span>y</span></div>';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands({
      Bad: () => document.createDocumentFragment(),
      Good: () => h('div', null, h('span', null, 'y')),
    });
    error.mockRestore();
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual(['error', 'active']);
  });

  it('a component that returns nothing still activates (an island that sets up its own effects)', () => {
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Imperative"><b>0</b></div>';
    activateIslands({
      Imperative: (el) => {
        el.querySelector('b')!.textContent = 'set by the island';
        return undefined;
      },
    });
    const island = document.querySelector('[data-forma-island]')!;
    expect(island.getAttribute('data-forma-status')).toBe('active');
    expect(island.textContent).toBe('set by the island');
  });
});
