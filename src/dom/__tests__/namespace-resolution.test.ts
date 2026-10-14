/**
 * Client-rendered SVG and MathML get the parser's namespaces without `svg()`
 * (FORMA-026; decision brief DR-9).
 *
 * `h()` builds a child before its parent exists, so a tag that is both HTML
 * and SVG (`a`, `title`, `script`, `style`, `font`) was created as HTML even
 * inside an `<svg>`, where the parser makes it SVG. Content built after
 * activation inside an SVG (a `createShow` branch, a list row, a switch case)
 * had the same defect. The namespace is now resolved from the parent: where
 * the parent is known the content is built in its namespace, and an element
 * built before it was known is rebuilt when it is inserted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h, svg, Fragment } from '../element';
import { createShow } from '../show';
import { createList } from '../list';
import { createSwitch } from '../switch';
import { createPortal } from '../portal';
import { mount } from '../mount';

const SVG = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

afterEach(() => {
  document.body.innerHTML = '';
});

/** `localName:namespace` for `root` and every element under it. */
const namespaces = (root: Element) =>
  [root, ...Array.from(root.querySelectorAll('*'))].map((el) => `${el.localName}:${el.namespaceURI}`);

/** The element the parser builds from `html`. */
function parsed(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe('h() resolves a dual-use tag from its parent', () => {
  it('builds a title and an a inside an svg in the SVG namespace without svg(), as the parser does', () => {
    const built = h('svg', { viewBox: '0 0 10 10' },
      h('title', null, 'Close'),
      h('a', { href: '#close' }, h('title', null, 'Link'), h('path', { d: 'M0 0L10 10' })),
    ) as unknown as Element;
    const server = parsed('<svg viewBox="0 0 10 10"><title>Close</title><a href="#close"><title>Link</title><path d="M0 0L10 10"></path></a></svg>');

    expect(namespaces(built)).toEqual(namespaces(server));
    expect(namespaces(built).every((entry) => entry.endsWith(`:${SVG}`))).toBe(true);
    expect(built.outerHTML).toBe(server.outerHTML);
  });

  it('a rebuilt element keeps its handlers, its reactive props and children, and its ref, and the discarded one stops updating', () => {
    const [label, setLabel] = createSignal('Close');
    const [target, setTarget] = createSignal('#close');
    const clicks: string[] = [];
    const refs: Element[] = [];
    let labelReads = 0;

    const dispose = createRoot((d) => {
      const built = h('svg', null,
        h('a', { href: () => target(), onClick: () => clicks.push('a'), ref: (el: Element) => refs.push(el) },
          h('title', null, () => { labelReads++; return label(); })),
      ) as unknown as Element;
      document.body.appendChild(built);
      return d;
    });

    const anchor = document.querySelector('a')!;
    const title = document.querySelector('title')!;
    expect([anchor.namespaceURI, title.namespaceURI]).toEqual([SVG, SVG]);
    expect(refs.at(-1)).toBe(anchor);
    anchor.dispatchEvent(new Event('click'));
    expect(clicks).toEqual(['a']);

    const readsBefore = labelReads;
    for (const [n, next] of ['Open', 'Closed', 'Gone'].entries()) {
      setLabel(next);
      setTarget(`#${next}`);
      expect(title.textContent).toBe(next);
      expect(anchor.getAttribute('href')).toBe(`#${next}`);
      // One read per update: the title's discarded HTML twin is not subscribed.
      expect(labelReads - readsBefore).toBe(n + 1);
    }
    dispose();
  });

  it('keeps an a and a title in HTML outside an svg, and inside a foreignObject or a desc, even when built in svg()', () => {
    expect(h('a', { href: '#x' })).toBeInstanceOf(HTMLAnchorElement);
    for (const build of [
      () => h('svg', null, h('foreignObject', null, h('div', null, h('a', { href: '#more' }, 'more')), h('a', { href: '#top' }, 'top'))),
      () => svg(() => h('svg', null, h('foreignObject', null, h('div', null, h('a', { href: '#more' }, 'more')), h('a', { href: '#top' }, 'top')))),
    ]) {
      const built = build() as unknown as Element;
      expect(namespaces(built)).toEqual([`svg:${SVG}`, `foreignObject:${SVG}`, `div:${XHTML}`, `a:${XHTML}`, `a:${XHTML}`]);
      expect(built.querySelectorAll('a')[1]).toBeInstanceOf(HTMLAnchorElement);
    }
    // A desc is an HTML integration point. (happy-dom's parser keeps an a there
    // in SVG; browsers do not, which e2e/adoption.spec.ts checks.)
    const desc = h('svg', null, h('desc', null, 'See ', h('a', { href: '#x' }, 'x'))) as unknown as Element;
    expect(namespaces(desc)).toEqual([`svg:${SVG}`, `desc:${SVG}`, `a:${XHTML}`]);
  });

  it('an element inside a Fragment child of an svg is SVG', () => {
    const built = h('svg', null, h(Fragment, null, h('title', null, 'T'), h('a', { href: '#a' }))) as unknown as Element;
    expect(namespaces(built)).toEqual([`svg:${SVG}`, `title:${SVG}`, `a:${SVG}`]);
  });

  it('a function child inside an svg builds in the SVG namespace on every run', () => {
    const [on, setOn] = createSignal(true);
    const refs: Element[] = [];
    const ref = (el: Element) => refs.push(el);
    const built = h('svg', null, () => (on() ? h('title', { ref }, 'On') : h('a', { ref, href: '#off' }, 'Off'))) as unknown as Element;
    expect(refs).toEqual([built.firstElementChild]);
    for (const [n, next] of [false, true, false].entries()) {
      setOn(next);
      expect(built.firstElementChild!.localName).toBe(next ? 'title' : 'a');
      expect(built.firstElementChild!.namespaceURI).toBe(SVG);
      // Built in SVG from the start: one element, one ref call, no rebuild.
      expect(refs).toHaveLength(n + 2);
      expect(refs.at(-1)).toBe(built.firstElementChild);
    }
  });
});

describe('control flow builds in the namespace of the element it inserts into', () => {
  it('a createShow inside an svg creates SVG elements on its first render and on every toggle', () => {
    const [on, setOn] = createSignal(true);
    const [text, setText] = createSignal('On');
    let reads = 0;
    const built = h('svg', null, createShow(on,
      () => h('title', null, () => { reads++; return text(); }),
      () => h('a', { href: '#off' }, h('circle', { r: '1' })),
    )) as unknown as Element;
    document.body.appendChild(built);

    const check = (tag: string) => {
      const first = built.firstElementChild!;
      expect(first.localName).toBe(tag);
      expect(namespaces(built).every((entry) => entry.endsWith(`:${SVG}`))).toBe(true);
      expect(built.children).toHaveLength(1);
    };
    check('title');
    setText('Still on');
    expect(built.querySelector('title')!.textContent).toBe('Still on');
    for (const next of [false, true, false, true]) {
      setOn(next);
      check(next ? 'title' : 'a');
      // A hidden branch's bindings are disposed with it: nothing reads the text.
      const before = reads;
      setText(`seen ${next}`);
      expect(reads - before).toBe(next ? 1 : 0);
    }
    setText('Back');
    expect(built.querySelector('title')!.textContent).toBe('Back');
  });

  it('list rows inside an svg are SVG when first rendered, when added and when moved, 40 and more', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
    const [items, setItems] = createSignal(keys(2));
    const built = h('svg', null, h('g', null,
      createList(items, (k) => k, (k) => h('a', { href: `#${k}`, 'data-k': k }, h('title', null, k))),
    )) as unknown as Element;
    document.body.appendChild(built);

    const rows = () => Array.from(built.querySelectorAll('g > a'));
    const allSvg = () => namespaces(built).every((entry) => entry.endsWith(`:${SVG}`));
    expect(rows().map((a) => a.getAttribute('data-k'))).toEqual(['k0', 'k1']);
    expect(allSvg()).toBe(true);

    setItems(keys(45));
    expect(rows()).toHaveLength(45);
    expect(allSvg()).toBe(true);
    const k10 = rows()[10];

    setItems(keys(45).reverse());
    expect(rows().map((a) => a.getAttribute('data-k'))).toEqual(keys(45).reverse());
    expect(rows()[34]).toBe(k10);
    expect(allSvg()).toBe(true);

    setItems(['k3', 'new', 'k1']);
    expect(rows().map((a) => a.getAttribute('data-k'))).toEqual(['k3', 'new', 'k1']);
    expect(allSvg()).toBe(true);
  });

  it('createSwitch cases inside an svg are SVG, cached cases included', () => {
    const [tab, setTab] = createSignal('a');
    const built = h('svg', null, createSwitch(tab, [
      { match: 'a', render: () => h('a', { href: '#a' }, 'A') },
      { match: 't', render: () => h('title', null, 'T') },
    ], () => h('style', null, 'circle{}'))) as unknown as Element;
    document.body.appendChild(built);

    const first = built.firstElementChild;
    for (const [next, tag] of [['a', 'a'], ['t', 'title'], ['other', 'style'], ['a', 'a'], ['t', 'title']] as const) {
      setTab(next);
      expect(built.firstElementChild!.localName).toBe(tag);
      expect(built.firstElementChild!.namespaceURI).toBe(SVG);
      expect(built.children).toHaveLength(1);
      // A case is cached: switching back re-inserts the node first shown.
      if (next === 'a') expect(built.firstElementChild).toBe(first);
    }
  });

  it('a portal into an svg, and mount() into an svg, create SVG elements', () => {
    const target = h('svg', { id: 'target' }) as unknown as Element;
    document.body.appendChild(target);
    createRoot(() => createPortal(() => h('title', null, 'Portaled'), target));
    expect(namespaces(target)).toEqual([`svg:${SVG}`, `title:${SVG}`]);

    const g = h('g', { id: 'mounted' }) as unknown as Element;
    target.appendChild(g);
    mount(() => h('a', { href: '#m' }, 'M') as unknown as HTMLElement, g as unknown as HTMLElement);
    expect(g.firstElementChild!.namespaceURI).toBe(SVG);
    expect(g.firstElementChild!.localName).toBe('a');
  });
});

describe('MathML', () => {
  it('h() creates math and its elements in the MathML namespace, and HTML inside a token element, as the parser does', () => {
    // happy-dom's parser has no MathML, so the browsers' parse is compared in
    // e2e/adoption.spec.ts; here, the namespaces the HTML standard gives.
    const built = h('p', null, h('math', null,
      h('mrow', null, h('mi', null, 'x'), h('mo', null, '+'), h('mn', null, '1')),
      h('mtext', null, h('b', null, 'bold')),
    )) as unknown as Element;

    expect(namespaces(built)).toEqual([
      `p:${XHTML}`, `math:${MATHML}`, `mrow:${MATHML}`, `mi:${MATHML}`, `mo:${MATHML}`, `mn:${MATHML}`, `mtext:${MATHML}`, `b:${XHTML}`,
    ]);
    expect(built.outerHTML).toBe('<p><math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mtext><b>bold</b></mtext></math></p>');
  });
});

describe('what adoption builds inside an SVG is SVG (FORMA-026)', () => {
  it('a show branch the server left empty, the branches it toggles to, and fresh keyed rows', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><svg viewBox="0 0 10 10">' +
      '<g id="show"><!--f:s0--><!--/f:s0--></g>' +
      '<g id="rows"><!--f:l0--><a data-forma-key="a" href="#a"><title>a</title></a><!--/f:l0--></g>' +
      '</svg></div>';
    const app = document.getElementById('app')!;
    const kept = app.querySelector('[data-forma-key="a"]')!;
    const [on, setOn] = createSignal(true);
    const [keys, setKeys] = createSignal(['a', 'b']);
    const warn = console.warn;
    console.warn = () => {};
    try {
      mount(() => h('svg', { viewBox: '0 0 10 10' },
        h('g', { id: 'show' }, createShow(on, () => h('title', null, 'On'), () => h('a', { href: '#off' }, 'Off'))),
        h('g', { id: 'rows' }, createList(keys, (k) => k, (k) => h('a', { 'data-forma-key': k, href: `#${k}` }, h('title', null, k)))),
      ) as unknown as HTMLElement, app);
    } finally {
      console.warn = warn;
    }

    const svgOnly = () => namespaces(app.querySelector('svg')!).every((entry) => entry.endsWith(`:${SVG}`));
    expect(app.querySelector('#show')!.firstElementChild!.localName).toBe('title');
    expect(app.querySelector('[data-forma-key="a"]')).toBe(kept);
    expect(app.querySelector('[data-forma-key="b"]')).not.toBeNull();
    expect(svgOnly()).toBe(true);
    for (const next of [false, true, false]) {
      setOn(next);
      expect(app.querySelector('#show')!.firstElementChild!.localName).toBe(next ? 'title' : 'a');
      expect(svgOnly()).toBe(true);
    }
    setKeys(['c', 'a', 'b']);
    expect(Array.from(app.querySelectorAll('#rows > a'), (a) => a.getAttribute('data-forma-key'))).toEqual(['c', 'a', 'b']);
    expect(svgOnly()).toBe(true);
  });
});

describe('adoption at the parser\'s HTML integration points (FORMA-026)', () => {
  it('adoption creates what the server left out of a desc or an mtext in HTML, and an svg in SVG anywhere', () => {
    document.body.innerHTML =
      '<div id="app" data-forma-ssr><div><svg><desc id="d"></desc></svg>' +
      '<math><mtext id="t"></mtext><annotation-xml id="x" encoding="application/mathml+xml"></annotation-xml></math></div></div>';
    const app = document.getElementById('app')!;
    const warn = console.warn;
    console.warn = () => {};
    try {
      mount(() => h('div', null,
        h('svg', null, h('desc', { id: 'd' }, h('a', { href: '#d' }, 'd'))),
        h('math', null,
          h('mtext', { id: 't' }, h('a', { href: '#t' }, 't'), h('mglyph')),
          h('annotation-xml', { id: 'x', encoding: 'application/mathml+xml' }, h('svg', null, h('title', null, 'x')))),
      ) as unknown as HTMLElement, app);
    } finally {
      console.warn = warn;
    }
    const ns = (sel: string) => `${app.querySelector(sel)!.localName}:${app.querySelector(sel)!.namespaceURI}`;
    expect(ns('#d a')).toBe(`a:${XHTML}`);
    expect(ns('#t a')).toBe(`a:${XHTML}`);
    expect(ns('#t mglyph')).toBe(`mglyph:${MATHML}`);
    expect(ns('#x svg')).toBe(`svg:${SVG}`);
    expect(ns('#x title')).toBe(`title:${SVG}`);
  });
});
