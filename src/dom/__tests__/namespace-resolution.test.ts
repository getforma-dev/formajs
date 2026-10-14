/**
 * SVG and MathML namespaces in client rendering and adoption (FORMA-026;
 * decision brief DR-9).
 *
 * A tag that is both HTML and SVG (`a`, `title`, `script`, `style`, `font`)
 * takes the namespace of the content being built. Where the parent is known
 * (a reactive child, a control-flow helper's renders once it is in the
 * document, a portal, `mount()`, adoption) that is the parent's content
 * namespace, as the parser gives it. A child passed to h() is built before its
 * parent exists, so it is HTML unless the tree is built inside `svg()`. SVG
 * and MathML names are created in their namespace wherever they appear.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h, svg } from '../element';
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
  vi.restoreAllMocks();
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

describe('h() gives a dual-use tag the namespace of the content it is built in', () => {
  it('a title or an a passed to h() before its svg parent exists stays HTML, and is SVG inside svg()', () => {
    const tree = () => h('svg', { viewBox: '0 0 10 10' },
      h('title', null, 'Close'),
      h('a', { href: '#close' }, h('path', { d: 'M0 0L10 10' })),
    ) as unknown as Element;

    expect(namespaces(tree())).toEqual([`svg:${SVG}`, `title:${XHTML}`, `a:${XHTML}`, `path:${SVG}`]);

    const wrapped = svg(tree);
    const server = parsed('<svg viewBox="0 0 10 10"><title>Close</title><a href="#close"><path d="M0 0L10 10"></path></a></svg>');
    expect(namespaces(wrapped)).toEqual(namespaces(server));
    expect(wrapped.outerHTML).toBe(server.outerHTML);
  });

  it("a foreignObject's or desc's content is HTML when built there: an eager child, a reactive child, and content built outside svg()", () => {
    expect(h('a', { href: '#x' })).toBeInstanceOf(HTMLAnchorElement);
    const html = (el: Element) => Array.from(el.querySelectorAll('a'), (a) => a.namespaceURI);

    const eager = h('svg', null, h('foreignObject', null, h('div', null, h('a', { href: '#more' }, 'more'))), h('desc', null, h('a', { href: '#d' }, 'd'))) as unknown as Element;
    expect(html(eager)).toEqual([XHTML, XHTML]);

    // Built with the parent known (a reactive child), inside svg() or not.
    for (const build of [(f: () => unknown) => f(), svg]) {
      const reactive = build(() => h('svg', null,
        h('foreignObject', null, () => h('a', { href: '#fo' }, 'fo')),
        h('desc', null, () => h('a', { href: '#desc' }, 'desc')),
        h('title', null, () => h('a', { href: '#title' }, 'title')),
      )) as unknown as Element;
      expect(html(reactive)).toEqual([XHTML, XHTML, XHTML]);
    }

    // Inside svg(), content for an integration point is built outside it, as documented.
    const content = h('div', null, h('a', { href: '#out' }, 'out'));
    const wrapped = svg(() => h('svg', null, h('foreignObject', null, content))) as unknown as Element;
    expect(namespaces(wrapped)).toEqual([`svg:${SVG}`, `foreignObject:${SVG}`, `div:${XHTML}`, `a:${XHTML}`]);
    // Built inside svg(), an eager a is SVG there: the documented reason to
    // build that content outside svg().
    const inside = svg(() => h('svg', null, h('foreignObject', null, h('a', { href: '#in' }, 'in')))) as unknown as Element;
    expect(inside.querySelector('a')!.namespaceURI).toBe(SVG);
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
      expect(refs).toHaveLength(n + 2);
      expect(refs.at(-1)).toBe(built.firstElementChild);
    }
  });
});

describe('control flow builds in the namespace of the element it inserts into', () => {
  it('a helper inside an svg renders its content once', () => {
    // The review's B1: a helper inserted into an svg must not render twice.
    const [items] = createSignal(['a', 'b', 'c']);
    let rows = 0;
    let refs = 0;
    let branches = 0;
    let cases = 0;
    let nested = 0;
    const built = h('svg', null,
      h('g', null, createList(items, (k) => k, (k) => { rows++; return h('circle', { 'data-k': k, ref: () => refs++ }); })),
      h('g', null, createShow(() => true, () => { branches++; return h('rect'); })),
      h('g', null, createSwitch(() => 'x', [{ match: 'x', render: () => { cases++; return h('path'); } }])),
      h('g', null, createList(() => [1, 2, 3, 4, 5], (k) => k, () => h('g', null, createShow(() => true, () => { nested++; return h('circle'); })))),
    ) as unknown as Element;
    document.body.appendChild(built);

    expect({ rows, refs, branches, cases, nested }).toEqual({ rows: 3, refs: 3, branches: 1, cases: 1, nested: 5 });
    expect(namespaces(built).every((entry) => entry.endsWith(`:${SVG}`))).toBe(true);
  });

  it('a createShow inside an svg renders each branch once, in SVG, inside svg() from its first render and on every toggle', () => {
    const [on, setOn] = createSignal(true);
    const [text, setText] = createSignal('On');
    let reads = 0;
    let renders = 0;
    const built = svg(() => h('svg', null, createShow(on,
      () => { renders++; return h('title', null, () => { reads++; return text(); }); },
      () => { renders++; return h('a', { href: '#off' }, h('circle', { r: '1' })); },
    ))) as unknown as Element;
    document.body.appendChild(built);

    const check = (tag: string) => {
      expect(built.firstElementChild!.localName).toBe(tag);
      expect(namespaces(built).every((entry) => entry.endsWith(`:${SVG}`))).toBe(true);
      expect(built.children).toHaveLength(1);
    };
    check('title');
    expect(renders).toBe(1);
    for (const [n, next] of [false, true, false, true].entries()) {
      setOn(next);
      check(next ? 'title' : 'a');
      expect(renders).toBe(n + 2);
      // A hidden branch's bindings are disposed with it: nothing reads the text.
      const before = reads;
      setText(`seen ${next}`);
      expect(reads - before).toBe(next ? 1 : 0);
    }
  });

  it('without svg(), a createShow inside an svg renders its first branch, built before the svg existed, in HTML, and every later branch in SVG', () => {
    const [on, setOn] = createSignal(true);
    const built = h('svg', null, createShow(on, () => h('title', null, 'On'), () => h('a', { href: '#off' }, 'Off'))) as unknown as Element;
    expect(built.firstElementChild!.namespaceURI).toBe(XHTML);
    for (const next of [false, true, false]) {
      setOn(next);
      expect(built.firstElementChild!.localName).toBe(next ? 'title' : 'a');
      expect(built.firstElementChild!.namespaceURI).toBe(SVG);
    }
  });

  it('list rows inside an svg are SVG when first rendered inside svg(), and when added or moved later without it', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
    for (const wrap of [true, false]) {
      const [items, setItems] = createSignal(keys(2));
      let renders = 0;
      const tree = () => h('svg', null, h('g', null,
        createList(items, (k) => k, (k) => { renders++; return h('a', { href: `#${k}`, 'data-k': k }, h('title', null, k)); }),
      )) as unknown as Element;
      const built = wrap ? svg(tree) : tree();
      document.body.appendChild(built);

      const rows = () => Array.from(built.querySelectorAll('g > a'));
      const ns = () => rows().map((a) => a.namespaceURI);
      // Rows built before the svg existed are HTML unless the tree is inside svg().
      expect(ns()).toEqual(wrap ? [SVG, SVG] : [XHTML, XHTML]);
      expect(renders).toBe(2);

      setItems(keys(45));
      expect(rows()).toHaveLength(45);
      expect(ns().slice(2).every((n) => n === SVG)).toBe(true);
      expect(renders).toBe(45);
      const k10 = rows()[10];

      setItems(keys(45).reverse());
      expect(rows().map((a) => a.getAttribute('data-k'))).toEqual(keys(45).reverse());
      expect(rows()[34]).toBe(k10);

      setItems(['k3', 'new', 'k1']);
      expect(rows().map((a) => a.getAttribute('data-k'))).toEqual(['k3', 'new', 'k1']);
      expect(rows()[1]!.namespaceURI).toBe(SVG);
      expect(rows()[1]!.querySelector('title')!.namespaceURI).toBe(SVG);
      expect(renders).toBe(46);
      document.body.innerHTML = '';
    }
  });

  it('createSwitch cases inside an svg are SVG, each rendered once, cached cases included', () => {
    const [tab, setTab] = createSignal('a');
    const renders: string[] = [];
    const built = svg(() => h('svg', null, createSwitch(tab, [
      { match: 'a', render: () => { renders.push('a'); return h('a', { href: '#a' }, 'A'); } },
      { match: 't', render: () => { renders.push('t'); return h('title', null, 'T'); } },
    ], () => { renders.push('fallback'); return h('style', null, 'circle{}'); }))) as unknown as Element;
    document.body.appendChild(built);

    const first = built.firstElementChild;
    expect(first!.namespaceURI).toBe(SVG);
    for (const [next, tag] of [['a', 'a'], ['t', 'title'], ['other', 'style'], ['a', 'a'], ['t', 'title']] as const) {
      setTab(next);
      expect(built.firstElementChild!.localName).toBe(tag);
      expect(built.firstElementChild!.namespaceURI).toBe(SVG);
      expect(built.children).toHaveLength(1);
      // A case is cached: switching back re-inserts the node first shown.
      if (next === 'a') expect(built.firstElementChild).toBe(first);
    }
    expect(renders).toEqual(['a', 't', 'fallback']);
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
  it('what adoption creates inside an SVG is built in SVG from the start: a ref on it is called once', () => {
    document.body.innerHTML = '<div id="app" data-forma-ssr><svg viewBox="0 0 10 10"><circle r="1"></circle></svg></div>';
    const app = document.getElementById('app')!;
    const refs: Element[] = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
      mount(() => h('svg', { viewBox: '0 0 10 10' },
        h('g', null, h('title', { ref: (el: Element) => refs.push(el) }, 'T'), h('a', { href: '#x' })),
      ) as unknown as HTMLElement, app);
    } finally {
      console.warn = warn;
    }
    const title = app.querySelector('title')!;
    expect(title.namespaceURI).toBe(SVG);
    expect(app.querySelector('a')!.namespaceURI).toBe(SVG);
    expect(refs).toEqual([title]);
  });

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
