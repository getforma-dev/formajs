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
import { createEffect, createSignal, onError } from 'forma/reactive';
import { h, Fragment, fragment } from '../element';
import { mount } from '../mount';
import { activateIslands } from '../activate';
import { createShow } from '../show';
import { createList } from '../list';
import { hydrateIsland } from '../hydrate';
import { templateMany } from '../template';

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

  it('an island that returns its own element stays active and keeps updating', () => {
    // 2.0.1's imperative pattern: wire the server DOM by hand, return `el`.
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Imp"><button>0</button></div>' +
      '<div data-forma-island="1" data-forma-component="Imp"><button>0</button></div>';
    activateIslands({
      Imp: (el) => {
        const [n, setN] = createSignal(0);
        const button = el.querySelector('button')!;
        button.addEventListener('click', () => setN(n() + 1));
        createEffect(() => { button.textContent = String(n()); });
        return el;
      },
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    const buttons = islands.map((i) => i.querySelector('button')!);
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['active', 'active']);
    buttons[0]!.click();
    buttons[0]!.click();
    buttons[1]!.click();
    buttons[0]!.click();
    expect(buttons.map((b) => b.textContent)).toEqual(['3', '1']);
  });

  it('an island that returns a detached DOM node is marked error with its code, its sibling unaffected', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Bad"><span>x</span></div>' +
      '<div data-forma-island="1" data-forma-component="Good"><span>y</span></div>';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands({
      Bad: () => document.createElement('span'),
      Good: () => h('div', null, h('span', null, 'y')),
    });
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual(['error', 'active']);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_NODE') && line.includes('"Bad"'))).toHaveLength(1);
    expect(document.querySelector('[data-forma-island="0"]')!.innerHTML).toBe('<span>x</span>');
  });

  it('an island that appends a fragment into its element and returns it, now empty, stays active', () => {
    // The templateMany pattern: build, append into `el`, wire, return the
    // fragment, which appending emptied. 2.0.1 kept such islands active.
    document.body.innerHTML = [0, 1].map((id) =>
      `<div data-forma-island="${id}" data-forma-component="Many"><p>server ${id}</p></div>`).join('');
    const setters: Array<(v: number) => void> = [];
    activateIslands({
      Many: (el) => {
        const fragment = templateMany('<button>0</button><i>tail</i>');
        el.append(fragment);
        const [n, setN] = createSignal(0);
        setters.push(setN);
        const button = el.querySelector('button')!;
        createEffect(() => { button.textContent = String(n()); });
        return fragment;
      },
    });

    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['active', 'active']);
    setters[0]!(5);
    setters[1]!(7);
    setters[0]!(6);
    expect(islands.map((i) => i.querySelector('button')!.textContent)).toEqual(['6', '7']);
    expect(islands[0]!.textContent).toBe('server 06tail');
  });

  it('onError receives FORMA_E_HYDRATE_NODE from activateIslands, mount() and hydrateIsland()', () => {
    const received: Array<[string, string | undefined]> = [];
    const off = onError((err, info) => {
      received.push([String((err as { code?: unknown }).code), info?.source]);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      document.body.innerHTML =
        '<div data-forma-island="0" data-forma-component="Detached"><span>x</span></div>' +
        '<div id="app" data-forma-ssr><p>m</p></div><div id="direct" data-forma-ssr><p>d</p></div>';
      activateIslands({ Detached: () => document.createElement('span') });
      mount(() => document.createElement('p') as unknown as HTMLElement, '#app');
      hydrateIsland(() => document.createElement('p'), document.getElementById('direct')!);
    } finally {
      error.mockRestore();
      off();
    }

    expect(received).toEqual([
      ['FORMA_E_HYDRATE_NODE', 'hydration'],
      ['FORMA_E_HYDRATE_NODE', 'hydration'],
      ['FORMA_E_HYDRATE_NODE', 'hydration'],
    ]);
    // A working island reports nothing.
    document.body.innerHTML = '<div data-forma-island="0" data-forma-component="Fine"><b>ok</b></div>';
    const off2 = onError((err) => received.push([String(err), 'unexpected']));
    activateIslands({ Fine: (el) => el });
    off2();
    expect(received).toHaveLength(3);
  });

  it('mount() of a detached DOM node keeps the server DOM, logs the code, disposes its effects and does not throw', () => {
    const app = serverPage();
    const before = app.innerHTML;
    const [n, setN] = createSignal(0);
    let runs = 0;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    let unmount: (() => void) | undefined;
    expect(() => {
      unmount = mount(() => {
        createEffect(() => { n(); runs++; });
        return document.createElement('p') as unknown as HTMLElement;
      }, app);
    }).not.toThrow();
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    expect(typeof unmount).toBe('function');
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(app.innerHTML).toBe(before);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_NODE'))).toHaveLength(1);
    // The component's effect ran once and was disposed with the root.
    expect(runs).toBe(1);
    setN(1);
    setN(2);
    expect(runs).toBe(1);
    unmount!();
    expect(app.innerHTML).toBe('');
  });

  it('hydrateIsland called directly with a detached node logs the code and keeps the server DOM', () => {
    const app = serverPage();
    const before = app.innerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = hydrateIsland(() => document.createElement('span'), app);
    const logged = error.mock.calls.map((call) => String(call[0]));
    error.mockRestore();

    expect(result).toBe(app);
    expect(app.hasAttribute('data-forma-ssr')).toBe(true);
    expect(app.innerHTML).toBe(before);
    expect(logged.filter((line) => line.includes('FORMA_E_HYDRATE_NODE'))).toHaveLength(1);
  });

  it("a root createShow or createList is adopted against the container's children", () => {
    document.body.innerHTML =
      '<div id="show" data-forma-ssr><!--f:s0--><button id="toggle">on</button><!--/f:s0--></div>' +
      '<ul id="list" data-forma-ssr><!--f:l0--><li data-forma-key="a">a</li><li data-forma-key="b">b</li><!--/f:l0--></ul>';
    const toggleButton = document.getElementById('toggle')!;
    const [on, setOn] = createSignal(true);
    const [items, setItems] = createSignal(['a', 'b']);
    const clicked: string[] = [];

    mount(() => createShow(on,
      () => h('button', { id: 'toggle', onClick: () => setOn(false) }, 'on'),
      () => h('em', null, 'off'),
    ) as unknown as HTMLElement, '#show');
    mount(() => createList(items, (x) => x, (x) => h('li', { onClick: () => clicked.push(x) }, x)) as unknown as HTMLElement, '#list');

    // The server's nodes are bound, not replaced.
    toggleButton.click();
    expect(document.getElementById('show')!.textContent).toBe('off');
    setOn(true);
    expect(document.getElementById('toggle')!.textContent).toBe('on');
    const serverRows = Array.from(document.querySelectorAll('#list li'));
    (serverRows[1] as HTMLElement).click();
    expect(clicked).toEqual(['b']);
    setItems(['b', 'c']);
    expect(Array.from(document.querySelectorAll('#list li'), (li) => li.textContent)).toEqual(['b', 'c']);
    expect(document.querySelector('#list li')).toBe(serverRows[1]);
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
