/**
 * The row-count check at list adoption (FORMA-123, decision brief DR-8).
 *
 * Rows without `data-forma-key` are matched by index. Before this check, a
 * client array shorter than the server's rows had the extra rows removed, and
 * one longer had rows rendered fresh, both silently: ksx's #5 lost the server
 * rows absent from a list's array before its state was seeded. Until keys
 * reach the format (FMIR's next revision), a count that differs keeps every
 * server row, removes nothing, and fails the island with a coded error, in
 * every build. Rows that carry `data-forma-key` keep matching by key.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal, onError } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';
import { activateIslands } from '../activate';
import { createShow } from '../show';
import { createList } from '../list';
import { hydrateIsland } from '../hydrate';

const CODE = 'FORMA_E_HYDRATE_LIST_COUNT';

afterEach(() => {
  document.body.innerHTML = '';
});

/** An unkeyed server list region of `rows` inside a `ul`. */
const serverList = (rows: string[]): string =>
  `<ul><!--f:l0-->${rows.map((r) => `<li>${r}</li>`).join('')}<!--/f:l0--></ul>`;

/** A list island whose rows are matched by index. */
const listIsland = (items: () => string[]) =>
  h('div', null, h('ul', null, createList(items, (x) => x, (x) => h('li', null, x))));

/** Every coded error onError receives, with its source, while `fn` runs. */
function captureErrors(fn: () => void): { received: Array<[string, string | undefined]>; logged: string[] } {
  const received: Array<[string, string | undefined]> = [];
  const off = onError((err, info) => {
    received.push([String((err as { code?: unknown }).code), info?.source]);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fn();
  } finally {
    off();
  }
  const logged = error.mock.calls.map((call) => String(call[0]));
  error.mockRestore();
  return { received, logged };
}

/** The nodes under `root`, in document order, for identity comparison. */
const nodesUnder = (root: Element): Node[] => {
  const out: Node[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
};

describe('list adoption row-count check', () => {
  describe.each([
    ["a client array shorter than the server's rows", ['a', 'b']],
    ["a client array longer than the server's rows", ['a', 'b', 'c', 'd']],
    ['an empty client array, as before its signal is seeded (ksx #5)', [] as string[]],
  ])('%s', (_label, clientItems) => {
    it('marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row', () => {
      document.body.innerHTML =
        `<div data-forma-island="0" data-forma-component="Mismatch">${serverList(['a', 'b', 'c'])}</div>` +
        `<div data-forma-island="1" data-forma-component="Agrees">${serverList(['x', 'y'])}</div>`;
      const mismatch = document.querySelector('[data-forma-island="0"]')!;
      const before = mismatch.innerHTML;
      const serverNodes = nodesUnder(mismatch);
      const [items, setItems] = createSignal(clientItems);

      const { received, logged } = captureErrors(() => {
        activateIslands({
          Mismatch: () => listIsland(items),
          Agrees: () => listIsland(() => ['x', 'y']),
        });
      });

      const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
      expect(statuses).toEqual(['error', 'active']);
      expect(mismatch.innerHTML).toBe(before);
      expect(nodesUnder(mismatch)).toEqual(serverNodes);
      expect(received).toEqual([[CODE, 'hydration']]);
      const coded = logged.filter((line) => line.includes(CODE));
      expect(coded).toHaveLength(1);
      expect(coded[0]).toContain('"Mismatch"');
      expect(coded[0]).toContain(`3 rows`);
      expect(coded[0]).toContain(`${clientItems.length} item`);

      // The failed island is inert: later updates reach no row.
      for (const next of [['a', 'b', 'c'], ['c'], ['d', 'e', 'f', 'g']]) {
        setItems(next);
        expect(mismatch.innerHTML).toBe(before);
      }
    });
  });

  it('a server region with no rows and a client array with items fails the island and inserts nothing', () => {
    document.body.innerHTML = `<div data-forma-island="0" data-forma-component="Empty">${serverList([])}</div>`;
    const island = document.querySelector('[data-forma-island="0"]')!;
    const before = island.innerHTML;

    const { received } = captureErrors(() => {
      activateIslands({ Empty: () => listIsland(() => ['a', 'b']) });
    });

    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(island.innerHTML).toBe(before);
    expect(island.querySelectorAll('li')).toHaveLength(0);
    expect(received).toEqual([[CODE, 'hydration']]);
  });

  it('equal counts adopt 40 unkeyed rows in place by index, as before, and keep reconciling', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `r${i}`);
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Rows">${serverList(rows)}</div>` +
      `<div data-forma-island="1" data-forma-component="Rows2">${serverList(['p', 'q'])}</div>`;
    const serverRows = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    const [items, setItems] = createSignal(rows);
    const clicked: string[] = [];

    const { received, logged } = captureErrors(() => {
      activateIslands({
        Rows: () => h('div', null, h('ul', null,
          createList(items, (x) => x, (x) => h('li', { onClick: () => clicked.push(x) }, x)))),
        Rows2: () => listIsland(() => ['p', 'q']),
      });
    });

    expect(received).toEqual([]);
    expect(logged).toEqual([]);
    const statuses = Array.from(document.querySelectorAll('[data-forma-island]'), (el) => el.getAttribute('data-forma-status'));
    expect(statuses).toEqual(['active', 'active']);
    const adopted = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    expect(adopted).toHaveLength(40);
    expect(adopted.every((li, i) => li === serverRows[i])).toBe(true);
    (adopted[0] as HTMLElement).click();
    (adopted[39] as HTMLElement).click();
    expect(clicked).toEqual(['r0', 'r39']);

    // After adoption the reconciler is keyed: a reversal moves the server rows.
    const reversed = rows.slice().reverse();
    setItems(reversed);
    const now = Array.from(document.querySelectorAll('[data-forma-island="0"] li'));
    expect(now.map((li) => li.textContent)).toEqual(reversed);
    expect(now[0]).toBe(serverRows[39]);
    setItems(rows.slice(0, 2));
    expect(Array.from(document.querySelectorAll('[data-forma-island="0"] li'), (li) => li.textContent)).toEqual(['r0', 'r1']);
  });

  it('rows that carry data-forma-key keep matching by key when the counts differ', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Keyed"><ul><!--f:l0-->' +
      '<li data-forma-key="a">a</li><li data-forma-key="b">b</li><li data-forma-key="c">c</li>' +
      '<!--/f:l0--></ul></div>';
    const [a, b, c] = Array.from(document.querySelectorAll('li'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { received } = captureErrors(() => {
      activateIslands({ Keyed: () => listIsland(() => ['a', 'c']) });
    });
    warn.mockRestore();

    expect(received).toEqual([]);
    expect(document.querySelector('[data-forma-island="0"]')!.getAttribute('data-forma-status')).toBe('active');
    const now = Array.from(document.querySelectorAll('li'));
    expect(now).toEqual([a, c]);
    expect(document.body.contains(b!)).toBe(false);
  });

  it('a mismatched list inside a show branch fails its island', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Nested"><section><!--f:s0-->' +
      serverList(['a', 'b']) +
      '<!--/f:s0--></section></div>';
    const island = document.querySelector('[data-forma-island="0"]')!;
    const before = island.innerHTML;

    const { received } = captureErrors(() => {
      activateIslands({
        Nested: () => h('div', null, h('section', null,
          createShow(() => true, () => h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)))))),
      });
    });

    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(island.innerHTML).toBe(before);
    expect(received).toEqual([[CODE, 'hydration']]);
  });

  it('an island failed by the row count keeps no handler or binding that adoption attached before the list', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Bad"><button>go</button><span>idle</span>' + serverList(['a', 'b']) + '</div>' +
      '<div data-forma-island="1" data-forma-component="Good"><button>go</button><span>idle</span>' + serverList(['a', 'b']) + '</div>';
    const [label, setLabel] = createSignal('idle');
    const clicks: string[] = [];
    const island = (name: string, items: string[]) => () => h('div', null,
      h('button', { onClick: () => clicks.push(name) }, 'go'),
      h('span', null, () => label()),
      h('ul', null, createList(() => items, (x) => x, (x) => h('li', null, x))));

    captureErrors(() => {
      activateIslands({ Bad: island('Bad', ['a']), Good: island('Good', ['a', 'b']) });
    });

    const [bad, good] = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    expect([bad!.getAttribute('data-forma-status'), good!.getAttribute('data-forma-status')]).toEqual(['error', 'active']);
    bad!.querySelector('button')!.click();
    good!.querySelector('button')!.click();
    expect(clicks).toEqual(['Good']);
    for (const next of ['busy', 'done', 'idle again']) {
      setLabel(next);
      expect(bad!.querySelector('span')!.textContent).toBe('idle');
      expect(good!.querySelector('span')!.textContent).toBe(next);
    }
  });

  it('onError receives FORMA_E_HYDRATE_LIST_COUNT from activateIslands, mount() and hydrateIsland(), and each keeps the server rows', () => {
    document.body.innerHTML =
      `<div data-forma-island="0" data-forma-component="Short">${serverList(['a', 'b'])}</div>` +
      `<div id="app" data-forma-ssr>${serverList(['a', 'b'])}</div>` +
      `<div id="direct" data-forma-ssr>${serverList(['a', 'b'])}</div>`;
    const before = document.body.innerHTML.replace(/ data-forma-status="[a-z]+"/, '');
    const short = () => h('ul', null, createList(() => ['a'], (x) => x, (x) => h('li', null, x)));
    let unmount: (() => void) | undefined;

    const { received, logged } = captureErrors(() => {
      activateIslands({ Short: () => h('div', null, short()) });
      expect(() => { unmount = mount(short as unknown as () => HTMLElement, '#app'); }).not.toThrow();
      expect(() => hydrateIsland(short, document.getElementById('direct')!)).not.toThrow();
    });

    expect(received).toEqual([[CODE, 'hydration'], [CODE, 'hydration'], [CODE, 'hydration']]);
    expect(logged.filter((line) => line.includes(CODE))).toHaveLength(3);
    expect(document.body.innerHTML.replace(/ data-forma-status="[a-z]+"/, '')).toBe(before);
    expect(document.getElementById('app')!.hasAttribute('data-forma-ssr')).toBe(true);
    expect(document.getElementById('direct')!.hasAttribute('data-forma-ssr')).toBe(true);
    expect(typeof unmount).toBe('function');
  });
});
