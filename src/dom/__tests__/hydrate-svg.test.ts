/**
 * SVG and MathML in adoption (FORMA-020; decision brief DR-5, DR-9 and R7).
 *
 * Adoption used to compare an element's `tagName` with the tag upper-cased.
 * An SVG element's `tagName` keeps its case (`svg`, `clipPath`), so every
 * inline SVG was taken for a mismatch and rebuilt, and the rebuild went through
 * plain h(), which creates a `title` or an `a` in the HTML namespace. These
 * tests adopt inline SVG with a MutationObserver watching, and pin the
 * namespace of anything adoption has to create.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';
import { activateIslands } from '../activate';
import { createList } from '../list';

const SVG = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Every mutation record under `root` while `run` runs. */
function recordsDuring(root: Node, run: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  run();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

/** Every DOM write under `root` while `run` runs, as `type:target:attribute`. */
function writesDuring(root: Node, run: () => void): string[] {
  return recordsDuring(root, run).map((r) => `${r.type}:${(r.target as Element).localName ?? r.target.nodeName}:${r.attributeName ?? ''}`);
}

/** The ticket's fixture: an icon button whose SVG has a title and a path. */
const ICON = '<svg viewBox="0 0 10 10"><title>Close</title><path d="M0 0L10 10"/></svg>';

describe('adopting inline SVG', () => {
  it('adopts a server-rendered inline SVG with no DOM write and no re-created node', () => {
    document.body.innerHTML = `<div id="app" data-forma-ssr><button id="close">${ICON}</button></div>`;
    const app = document.getElementById('app')!;
    const svg = app.querySelector('svg')!;
    const title = svg.querySelector('title')!;
    const path = svg.querySelector('path')!;
    const [d, setD] = createSignal('M0 0L10 10');

    const writes = writesDuring(app, () => {
      mount(() => h('button', { id: 'close' },
        h('svg', { viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('path', { d: () => d() })),
      ), app);
    });

    // The only write is mount() removing data-forma-ssr from its container.
    expect(writes).toEqual(['attributes:div:data-forma-ssr']);
    expect(app.querySelector('svg')).toBe(svg);
    expect(svg.querySelector('title')).toBe(title);
    expect(svg.querySelector('path')).toBe(path);
    expect(title.namespaceURI).toBe(SVG);
    expect(title.textContent).toBe('Close');

    // The bound attribute updates the server's path in place, three times over.
    for (const next of ['M10 0L0 10', 'M0 5L10 5', 'M0 0L10 10']) {
      expect(writesDuring(app, () => setD(next))).toEqual(['attributes:path:d']);
      expect(app.querySelector('path')).toBe(path);
      expect(path.getAttribute('d')).toBe(next);
    }
    expect(app.querySelectorAll('svg, title, path')).toHaveLength(3);
  });

  it('adopts the inline SVG of every island in place, each on its own', () => {
    document.body.innerHTML = [0, 1].map((id) =>
      `<span data-forma-island="${id}" data-forma-component="Icon">${ICON}</span>`,
    ).join('');
    const islands = Array.from(document.querySelectorAll<HTMLElement>('[data-forma-island]'));
    const svgs = islands.map((island) => island.querySelector('svg')!);
    const paths = islands.map((island) => island.querySelector('path')!);
    const setters: Array<(d: string) => void> = [];

    const writes = writesDuring(document.body, () => {
      activateIslands({
        Icon: () => {
          const [d, setD] = createSignal('M0 0L10 10');
          setters.push(setD);
          return h('span', null,
            h('svg', { viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('path', { d: () => d() })));
        },
      });
    });

    // activateIslands writes status attributes on each island root; inside an
    // island nothing is written.
    expect(writes.filter((w) => !w.startsWith('attributes:span:'))).toEqual([]);
    expect(islands.map((i) => i.getAttribute('data-forma-status'))).toEqual(['active', 'active']);
    expect(islands.map((i) => i.querySelector('svg'))).toEqual(svgs);
    expect(islands.map((i) => i.querySelector('title')!.namespaceURI)).toEqual([SVG, SVG]);

    const ds = () => islands.map((i) => i.querySelector('path')!.getAttribute('d'));
    setters[0]!('M1 1');
    expect(ds()).toEqual(['M1 1', 'M0 0L10 10']);
    setters[1]!('M2 2');
    expect(ds()).toEqual(['M1 1', 'M2 2']);
    setters[0]!('M3 3');
    expect(ds()).toEqual(['M3 3', 'M2 2']);
    expect(islands.map((i) => i.querySelector('path'))).toEqual(paths);
  });

  it('adopts case-sensitive SVG tags such as clipPath and linearGradient in place', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><svg viewBox="0 0 10 10"><defs>' +
      '<clipPath id="clip"><rect width="10" height="5"/></clipPath>' +
      '<linearGradient id="fade"><stop offset="0"/><stop offset="1"/></linearGradient>' +
      '</defs><rect clip-path="url(#clip)" fill="url(#fade)" width="10" height="10"/></svg></div>';
    const app = document.getElementById('app')!;
    const clipPath = app.querySelector('clipPath')!;
    const clipRect = clipPath.querySelector('rect')!;
    const gradient = app.querySelector('linearGradient')!;
    const [height, setHeight] = createSignal('5');

    const writes = writesDuring(app, () => {
      mount(() => h('svg', { viewBox: '0 0 10 10' },
        h('defs', null,
          h('clipPath', { id: 'clip' }, h('rect', { width: '10', height: () => height() })),
          h('linearGradient', { id: 'fade' }, h('stop', { offset: '0' }), h('stop', { offset: '1' })),
        ),
        h('rect', { 'clip-path': 'url(#clip)', fill: 'url(#fade)', width: '10', height: '10' }),
      ), app);
    });

    expect(writes).toEqual(['attributes:div:data-forma-ssr']);
    expect(clipPath.localName).toBe('clipPath');
    expect(app.querySelector('clipPath')).toBe(clipPath);
    expect(app.querySelector('linearGradient')).toBe(gradient);
    setHeight('7');
    expect(clipRect.getAttribute('height')).toBe('7');
    expect(app.querySelector('clipPath rect')).toBe(clipRect);
  });

  it("binds a reactive SVG title by the element without writing, and it stays in the SVG namespace", () => {
    document.body.innerHTML = `<div id="app" data-forma-ssr>${ICON}</div>`;
    const app = document.getElementById('app')!;
    const title = app.querySelector('title')!;
    const [label, setLabel] = createSignal('Close');

    const writes = writesDuring(app, () => {
      mount(() => h('svg', { viewBox: '0 0 10 10' }, h('title', null, () => label()), h('path', { d: 'M0 0L10 10' })), app);
    });

    expect(writes).toEqual(['attributes:div:data-forma-ssr']);
    for (const next of ['Open', 'Dismiss', 'Close']) {
      setLabel(next);
      expect(app.querySelector('title')).toBe(title);
      expect(title.textContent).toBe(next);
    }
    expect(title.namespaceURI).toBe(SVG);
  });

  it('adopts a list of 40 SVG rows without re-creating one, and keeps them through updates', () => {
    const row = (id: number) => `<circle data-forma-key="${id}" cx="${id * 10}" r="1"/>`;
    const ids = Array.from({ length: 40 }, (_, i) => i);
    document.body.innerHTML =
      `<div id="app" data-forma-ssr><svg viewBox="0 0 400 10"><g><!--f:l0-->${ids.map(row).join('')}<!--/f:l0--></g></svg></div>`;
    const app = document.getElementById('app')!;
    const server = new Map(Array.from(app.querySelectorAll('circle'), (c) => [c.getAttribute('data-forma-key'), c]));
    const [items, setItems] = createSignal(ids.map((id) => ({ id })));
    const [r, setR] = createSignal('1');

    const records = recordsDuring(app, () => {
      mount(() => h('svg', { viewBox: '0 0 400 10' },
        h('g', null, createList(items, (item) => item.id, (item) =>
          h('circle', { 'data-forma-key': String(item.id), cx: String(item.id * 10), r: () => r() }))),
      ), app);
    });

    // List adoption re-inserts each adopted row before the region's end marker
    // (a move of the server's own node, the same for HTML rows), so the
    // observer sees childList records; none of them adds a node of its own.
    const serverNodes = new Set<Node>(server.values());
    const added = records.flatMap((rec) => Array.from(rec.addedNodes));
    expect(added.filter((n) => !serverNodes.has(n))).toEqual([]);
    expect(records.filter((rec) => rec.type !== 'childList').map((rec) => rec.attributeName)).toEqual(['data-forma-ssr']);
    const circles = () => Array.from(app.querySelectorAll('circle'));
    expect(circles()).toHaveLength(40);
    expect(circles().every((c) => c === server.get(c.getAttribute('data-forma-key')) && c.namespaceURI === SVG)).toBe(true);

    // Reverse, then drop the first ten: every row left is the server's.
    setItems(ids.slice().reverse().map((id) => ({ id })));
    expect(circles().map((c) => c.getAttribute('data-forma-key'))).toEqual(ids.slice().reverse().map(String));
    setItems(ids.slice(10).map((id) => ({ id })));
    expect(circles()).toHaveLength(30);
    expect(circles().every((c) => c === server.get(c.getAttribute('data-forma-key')))).toBe(true);
    setR('2');
    expect(circles().every((c) => c.getAttribute('r') === '2')).toBe(true);
  });
});

describe('what adoption creates inside SVG and MathML', () => {
  it('rebuilds a mismatched SVG child in the SVG namespace, title and a included', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div id="app" data-forma-ssr><svg viewBox="0 0 10 10"><circle r="1"/></svg></div>';
    const app = document.getElementById('app')!;
    const svg = app.querySelector('svg')!;

    mount(() => h('svg', { viewBox: '0 0 10 10' },
      h('title', null, 'Close'),
      h('a', { href: '#close' }, h('path', { d: 'M0 0L10 10' })),
    ), app);

    expect(app.querySelector('svg')).toBe(svg);
    expect(Array.from(svg.children, (el) => `${el.localName}:${el.namespaceURI}`)).toEqual([`title:${SVG}`, `a:${SVG}`]);
    expect(svg.querySelector('title')!.textContent).toBe('Close');
    expect(svg.querySelector('a path')!.namespaceURI).toBe(SVG);
    expect(svg.querySelector('a')!.getAttribute('href')).toBe('#close');
  });

  it('rebuilds a mismatched SVG list row in the SVG namespace', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><svg><!--f:l0--><g data-forma-key="a"></g><g data-forma-key="b"></g><!--/f:l0--></svg></div>';
    const app = document.getElementById('app')!;
    const keptRow = app.querySelector('[data-forma-key="b"]')!;

    mount(() => h('svg', null, createList(() => ['a', 'b'], (k) => k, (k) => k === 'a'
      ? h('a', { 'data-forma-key': k, href: '#a' }, h('title', null, 'A'))
      : h('g', { 'data-forma-key': k }))), app);

    const rebuilt = app.querySelector('[data-forma-key="a"]')!;
    expect(rebuilt.localName).toBe('a');
    expect(rebuilt.namespaceURI).toBe(SVG);
    expect(rebuilt.querySelector('title')!.namespaceURI).toBe(SVG);
    expect(app.querySelector('[data-forma-key="b"]')).toBe(keptRow);
  });

  it('creates the content of a foreignObject in the HTML namespace', () => {
    // #kept: the server rendered the foreignObject but not its content.
    // #empty: the server rendered neither, so the foreignObject is created too.
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><div>' +
      '<svg id="kept" viewBox="0 0 10 10"><foreignObject width="10" height="10"></foreignObject></svg>' +
      '<svg id="empty" viewBox="0 0 10 10"></svg></div></div>';
    const app = document.getElementById('app')!;
    const foreignObject = app.querySelector('#kept foreignObject')!;
    const content = () => h('foreignObject', { width: '10', height: '10' }, h('div', null, h('a', { href: '#more' }, 'more')));

    mount(() => h('div', null,
      h('svg', { id: 'kept', viewBox: '0 0 10 10' }, content()),
      h('svg', { id: 'empty', viewBox: '0 0 10 10' }, content()),
    ), app);

    expect(app.querySelector('#kept foreignObject')).toBe(foreignObject);
    for (const id of ['kept', 'empty']) {
      const created = Array.from(app.querySelectorAll(`#${id} *`), (el) => `${el.localName}:${el.namespaceURI}`);
      expect(created).toEqual([`foreignObject:${SVG}`, `div:${XHTML}`, `a:${XHTML}`]);
      expect(app.querySelector(`#${id} a`)).toBeInstanceOf(HTMLAnchorElement);
    }
  });

  it('creates MathML the server did not render in the MathML namespace', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div id="app" data-forma-ssr><p id="formula"></p></div>';
    const app = document.getElementById('app')!;
    const p = document.getElementById('formula')!;
    const [x, setX] = createSignal('x');

    mount(() => h('p', { id: 'formula' }, h('math', null, h('mi', null, () => x()), h('mo', null, '+'), h('mn', null, '1'))), app);

    expect(app.querySelector('#formula')).toBe(p);
    expect(Array.from(p.querySelectorAll('*'), (el) => `${el.localName}:${el.namespaceURI}`)).toEqual(
      [`math:${MATHML}`, `mi:${MATHML}`, `mo:${MATHML}`, `mn:${MATHML}`],
    );
    setX('y');
    expect(p.textContent).toBe('y+1');
  });
});

describe('reactive attributes at adoption', () => {
  it('writes nothing where the server already holds the value, and still writes every change', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><a id="link" href="/a" class="on" aria-busy="true"><button id="b" disabled>go</button></a></div>';
    const app = document.getElementById('app')!;
    const [href, setHref] = createSignal('/a');
    const [busy, setBusy] = createSignal<boolean | string>('true');
    const [disabled, setDisabled] = createSignal(true);

    const writes = writesDuring(app, () => {
      mount(() => h('a', { id: 'link', href: () => href(), className: () => 'on', 'aria-busy': () => busy() },
        h('button', { id: 'b', disabled: () => disabled() }, 'go')), app);
    });
    expect(writes).toEqual(['attributes:div:data-forma-ssr']);

    const link = document.getElementById('link')!;
    const button = document.getElementById('b')!;
    expect(writesDuring(app, () => setHref('/b'))).toEqual(['attributes:a:href']);
    expect(link.getAttribute('href')).toBe('/b');
    expect(writesDuring(app, () => setDisabled(false))).toEqual(['attributes:button:disabled']);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(writesDuring(app, () => setDisabled(true))).toEqual(['attributes:button:disabled']);
    expect(button.getAttribute('disabled')).toBe('');
    expect(writesDuring(app, () => setBusy(true))).toEqual(['attributes:a:aria-busy']);
    expect(link.getAttribute('aria-busy')).toBe('');
  });
});
