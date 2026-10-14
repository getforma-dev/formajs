/**
 * Raw HTML's typed entry, `trustedHtml()`, and core's own sink writes under
 * Trusted Types (FORMA-126, FORMA-127; decision brief DR-19, DR-20, L-37).
 *
 * happy-dom has no Trusted Types, so `enforceTrustedTypes()` below supplies
 * one: a `trustedTypes` factory and every HTML sink happy-dom has, checked as
 * a browser checks them under `require-trusted-types-for 'script';
 * trusted-types forma forma-runtime`. It is a stand-in for a browser API the
 * test environment lacks (CONTRIBUTING rule 8), and its control test proves it
 * refuses what a browser refuses. The real browser runs the same pages in
 * e2e/trusted-types.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';
import { template, templateMany } from '../template';
import { createReconciler } from '../reconcile';
import { setHTMLUnsafe } from '../../dom-utils/mutate';
import { renderToString, sh } from '../../ssr/render';
import { renderToStream } from '../../ssr/stream';
import {
  POLICY_REFUSED_CODE,
  RAW_STRING_CODES,
  isTrustedHtml,
  trustedHtml,
  type RawSink,
  type TrustedHtml,
} from '../trusted-html';
import type { RuntimeParser } from '../runtime-parser';

const REGISTRY = Symbol.for('@getforma/core#trusted-types');
type Host = Record<symbol, unknown>;

// ---------------------------------------------------------------------------
// A Trusted Types engine for happy-dom
// ---------------------------------------------------------------------------

/** What the simulated browser's policies return. */
class FakeTrustedHTML {
  constructor(readonly markup: string, readonly policy: string) {}
  toString(): string {
    return this.markup;
  }
}

interface TrustedTypesSim {
  /** Each sink write that was not a TrustedHTML, as `sink markup`. */
  violations: string[];
  /** Each policy created, in order. */
  policies: string[];
  /** Each value a policy minted. */
  minted: FakeTrustedHTML[];
  restore(): void;
}

/**
 * Install Trusted Types on happy-dom: `trustedTypes.createPolicy` allowing
 * `forma` and `forma-runtime` once each, `isHTML`, and the HTML sinks
 * happy-dom defines (`innerHTML` and `outerHTML` on elements, templates and
 * shadow roots, `insertAdjacentHTML`, an iframe's `srcdoc` property and
 * attribute). A string at a sink is a violation: recorded, then refused
 * (enforced) or written (`reportOnly`), as a browser does.
 */
function enforceTrustedTypes({ reportOnly = false } = {}): TrustedTypesSim {
  const sim: TrustedTypesSim = { violations: [], policies: [], minted: [], restore() {} };
  const restores: Array<() => void> = [];

  const check = (sink: string, value: unknown): unknown => {
    if (value instanceof FakeTrustedHTML) return value.markup;
    sim.violations.push(`${sink} ${String(value)}`);
    if (!reportOnly) throw new TypeError(`This document requires 'TrustedHTML' assignment (${sink}).`);
    return value;
  };

  (globalThis as Host & { trustedTypes?: unknown }).trustedTypes = {
    createPolicy(name: string, rules: { createHTML(input: string): string }) {
      if (!['forma', 'forma-runtime'].includes(name) || sim.policies.includes(name)) {
        sim.violations.push(`trusted-types ${name}`);
        if (!reportOnly) throw new TypeError(`Refused to create a TrustedTypePolicy named '${name}'.`);
      }
      sim.policies.push(name);
      return {
        createHTML(input: string) {
          const value = new FakeTrustedHTML(rules.createHTML(input), name);
          sim.minted.push(value);
          return value;
        },
      };
    },
    isHTML: (value: unknown) => value instanceof FakeTrustedHTML,
  };
  restores.push(() => { delete (globalThis as { trustedTypes?: unknown }).trustedTypes; });

  const wrapSetter = (proto: object, prop: string): void => {
    const original = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(proto, prop, {
      ...original,
      set(this: Element, value: unknown) { original.set!.call(this, check(prop, value)); },
    });
    restores.push(() => Object.defineProperty(proto, prop, original));
  };
  wrapSetter(Element.prototype, 'innerHTML');
  wrapSetter(Element.prototype, 'outerHTML');
  wrapSetter(HTMLTemplateElement.prototype, 'innerHTML');
  wrapSetter(ShadowRoot.prototype, 'innerHTML');
  wrapSetter(HTMLIFrameElement.prototype, 'srcdoc');

  const proto = Element.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const insertAdjacentHTML = proto.insertAdjacentHTML!;
  proto.insertAdjacentHTML = function (this: Element, where: unknown, html: unknown) {
    return insertAdjacentHTML.call(this, where, check('insertAdjacentHTML', html));
  };
  restores.push(() => { proto.insertAdjacentHTML = insertAdjacentHTML; });
  const setAttribute = proto.setAttribute!;
  proto.setAttribute = function (this: Element, name: unknown, value: unknown) {
    const sink = this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'srcdoc';
    return setAttribute.call(this, name, sink ? check('srcdoc', value) : value);
  };
  restores.push(() => { proto.setAttribute = setAttribute; });

  sim.restore = () => { for (const undo of restores.reverse()) undo(); };
  return sim;
}

/** A reconciler with no runtime behind it: the parser alone. */
const reconcile = createReconciler({
  mountScope() {},
  unmountScope() {},
  disconnectObserver() {},
  reconnectObserver() {},
  batch: (fn) => fn(),
});

/** The console.warn lines that carry `code`. */
function linesWith(warn: { mock: { calls: unknown[][] } }, code: string): string[] {
  return warn.mock.calls.map((args) => String(args[0])).filter((line) => line.includes(code));
}

let sim: TrustedTypesSim | null = null;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete (globalThis as Host)[REGISTRY];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  sim?.restore();
  sim = null;
  delete (globalThis as Host)[REGISTRY];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('trustedHtml()', () => {
  it('trustedHtml() returns a TrustedHTML from the forma policy where the browser has Trusted Types', async () => {
    sim = enforceTrustedTypes();
    const first = trustedHtml('<b>one</b>') as unknown;
    const second = trustedHtml('<i>two</i>') as unknown;

    expect(first).toBeInstanceOf(FakeTrustedHTML);
    expect((first as FakeTrustedHTML).policy).toBe('forma');
    expect(String(first)).toBe('<b>one</b>');
    expect(String(second)).toBe('<i>two</i>');
    // A second copy of the module (the runtime's IIFE beside core's ESM, a
    // development twin, a reload) finds the page's policy instead of asking
    // for the name again, which an enforcing page refuses.
    vi.resetModules();
    const again = await import('../trusted-html');
    expect(String(again.trustedHtml('<u>three</u>'))).toBe('<u>three</u>');
    expect(sim.policies).toEqual(['forma']);
    expect(sim.violations).toEqual([]);
  });

  it('without Trusted Types it returns a frozen stand-in that core recognises', () => {
    const value = trustedHtml('<b>x</b>');
    expect(Object.isFrozen(value)).toBe(true);
    expect(String(value)).toBe('<b>x</b>');
    expect(JSON.stringify({ value })).toBe('{"value":"<b>x</b>"}');
    expect(isTrustedHtml(value)).toBe(true);
    // A stand-in's markup is what it was made with, whatever its methods say.
    const el = h('div', { dangerouslySetInnerHTML: { __html: value } });
    expect(el.innerHTML).toBe('<b>x</b>');
  });

  it('a look-alike object is not trusted HTML', () => {
    const lookAlikes: unknown[] = [
      '<b>x</b>',
      { toString: () => '<b>x</b>' },
      { __formaTrustedHtml: true, toString: () => '<b>x</b>' },
      JSON.parse('{"__formaTrustedHtml":true,"toString":"<b>x</b>"}'),
      JSON.parse(JSON.stringify(trustedHtml('<b>x</b>'))),
      null,
      undefined,
      7,
    ];
    lookAlikes.forEach((value, i) => expect(isTrustedHtml(value), `look-alike ${i}`).toBe(false));
    // The real one, beside them.
    expect(isTrustedHtml(trustedHtml('<b>x</b>'))).toBe(true);

    // At a sink, a look-alike is refused and writes nothing; the real one renders.
    const target = h('div', null, 'kept');
    expect(() => h('div', { dangerouslySetInnerHTML: { __html: lookAlikes[1] } })).toThrow(TypeError);
    expect(() => reconcile(target, lookAlikes[2] as string)).toThrow(TypeError);
    expect(target.textContent).toBe('kept');
    reconcile(target, trustedHtml('<p>new</p>'));
    expect(target.innerHTML).toBe('<p>new</p>');
  });
});

describe('the raw sinks', () => {
  /** Each raw sink: write `html` into a fresh element and return what the DOM holds. */
  const SINKS: Record<RawSink, (html: string | TrustedHtml) => string> = {
    innerHTML: (html) => h('div', { dangerouslySetInnerHTML: { __html: html } }).innerHTML,
    setHTMLUnsafe: (html) => {
      const el = h('div');
      setHTMLUnsafe(el, html);
      return el.innerHTML;
    },
    template: (html) => {
      const one = (template(html).cloneNode(true) as Element).outerHTML;
      const many = templateMany(html);
      return `${one}|${many.childNodes.length}`;
    },
    reconcile: (html) => {
      const el = h('div');
      reconcile(el, html);
      return el.innerHTML;
    },
    srcdoc: (html) => h('iframe', { srcdoc: html }).getAttribute('srcdoc')!,
  };
  const EXPECTED: Record<RawSink, (markup: string) => string> = {
    innerHTML: (m) => m,
    setHTMLUnsafe: (m) => m,
    template: (m) => `${m}|1`,
    reconcile: (m) => m,
    srcdoc: (m) => m,
  };

  it('the sink table covers every raw sink the warnings name', () => {
    expect(Object.keys(SINKS).sort()).toEqual(Object.keys(RAW_STRING_CODES).sort());
    expect(Object.values(RAW_STRING_CODES).map(([code]) => code).sort()).toEqual([
      'FORMA_W_RAW_INNER_HTML',
      'FORMA_W_RAW_RECONCILE',
      'FORMA_W_RAW_SET_HTML',
      'FORMA_W_RAW_SRCDOC',
      'FORMA_W_RAW_TEMPLATE',
    ]);
  });

  it('every raw sink writes a trustedHtml() value without a warning, and the DOM holds its markup', () => {
    for (const [sink, write] of Object.entries(SINKS) as Array<[RawSink, typeof SINKS[RawSink]]>) {
      const markup = `<p class="${sink}">typed ${sink}</p>`;
      expect(write(trustedHtml(markup)), sink).toBe(EXPECTED[sink](markup));
    }
    expect(linesWith(warn, 'FORMA_W_RAW_')).toEqual([]);
  });

  it("a string to each raw sink still renders, and warns once with the sink's code in development", () => {
    for (const [sink, write] of Object.entries(SINKS) as Array<[RawSink, typeof SINKS[RawSink]]>) {
      const [code] = RAW_STRING_CODES[sink];
      const first = `<p class="${sink}">first ${sink}</p>`;
      const second = `<p class="${sink}">second ${sink}</p>`;
      // L-18: the string form keeps working, exactly as before.
      expect(write(first), sink).toBe(EXPECTED[sink](first));
      expect(write(second), sink).toBe(EXPECTED[sink](second));
      const lines = linesWith(warn, code);
      expect(lines, sink).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^\\[forma\\] ${code}: `));
      expect(lines[0]).toContain('trustedHtml()');
      expect(lines[0]).toContain('3.0.0');
    }
    // One line per sink, and each names only its own code.
    expect(linesWith(warn, 'FORMA_W_RAW_')).toHaveLength(Object.keys(SINKS).length);
  });

  it('a reactive dangerouslySetInnerHTML and srcdoc take trustedHtml() values through every transition', () => {
    const [html, setHtml] = createSignal<{ __html: string | TrustedHtml } | null>({ __html: trustedHtml('<b>one</b>') });
    const [doc, setDoc] = createSignal<string | TrustedHtml>(trustedHtml('<p>a</p>'));
    const box = h('div', { dangerouslySetInnerHTML: () => html() });
    const frame = h('iframe', { srcdoc: () => doc() });
    expect(box.innerHTML).toBe('<b>one</b>');
    expect(frame.getAttribute('srcdoc')).toBe('<p>a</p>');

    setHtml(null);
    setDoc(trustedHtml('<p>b</p>'));
    expect(box.childNodes.length).toBe(0);
    expect(frame.getAttribute('srcdoc')).toBe('<p>b</p>');

    setHtml({ __html: trustedHtml('<i>two</i>') });
    setDoc(trustedHtml('<p>c</p>'));
    expect(box.innerHTML).toBe('<i>two</i>');
    expect(frame.getAttribute('srcdoc')).toBe('<p>c</p>');

    setHtml({ __html: '<u>three</u>' });
    expect(box.innerHTML).toBe('<u>three</u>');
    expect(linesWith(warn, 'FORMA_W_RAW_INNER_HTML')).toHaveLength(1);
    expect(linesWith(warn, 'FORMA_W_RAW_SRCDOC')).toEqual([]);
  });

  it("h('script') warns once in development and still builds the element", () => {
    const style = h('style');
    const link = h('a', { href: '/x' });
    expect(linesWith(warn, 'FORMA_W_SCRIPT_ELEMENT')).toEqual([]);

    const first = h('script', { type: 'module' });
    const second = h('script');
    expect(first.localName).toBe('script');
    expect(first.getAttribute('type')).toBe('module');
    expect(second.localName).toBe('script');
    expect(style.localName).toBe('style');
    expect(link.getAttribute('href')).toBe('/x');
    const lines = linesWith(warn, 'FORMA_W_SCRIPT_ELEMENT');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[forma\] FORMA_W_SCRIPT_ELEMENT: h\('script'\)/);
    expect(lines[0]).toContain('3.0.0');
  });

  it('a look-alike object or a String object is written as before and warns as a string does', () => {
    // formajs#29's review (N1). Each sink treats a value that is not
    // trustedHtml() as 2.0 did; the ones that converted it still do, and now
    // say so with their code, as for a string.
    const lookAlike = { toString: () => '<b>look-alike</b>' };
    const boxed = new String('<i>boxed</i>');
    const target = h('div');
    setHTMLUnsafe(target, lookAlike as unknown as string);
    expect(target.innerHTML).toBe('<b>look-alike</b>');
    expect((template(boxed as unknown as string).cloneNode(true) as Element).outerHTML).toBe('<i>boxed</i>');
    expect(h('iframe', { srcdoc: lookAlike }).getAttribute('srcdoc')).toBe('<b>look-alike</b>');
    for (const code of ['FORMA_W_RAW_SET_HTML', 'FORMA_W_RAW_TEMPLATE', 'FORMA_W_RAW_SRCDOC']) {
      expect(linesWith(warn, code), code).toHaveLength(1);
    }
    // The two that refused a non-string in 2.0 still refuse it, writing nothing.
    const kept = h('div', null, 'kept');
    expect(() => h('div', { dangerouslySetInnerHTML: { __html: boxed } })).toThrow(TypeError);
    expect(() => reconcile(kept, boxed as unknown as string)).toThrow(TypeError);
    expect(kept.textContent).toBe('kept');
  });
});

describe('core under Trusted Types (simulated: happy-dom has none)', () => {
  it('the simulated enforcement refuses a string at every sink it covers', () => {
    sim = enforceTrustedTypes();
    const div = document.createElement('div');
    const frame = document.createElement('iframe');
    const tpl = document.createElement('template');
    const writes: Array<() => void> = [
      () => { div.innerHTML = '<b>x</b>'; },
      () => { div.innerHTML = ''; },
      () => { tpl.innerHTML = '<b>x</b>'; },
      () => { div.insertAdjacentHTML('beforeend', '<b>x</b>'); },
      () => { frame.srcdoc = '<b>x</b>'; },
      () => { frame.setAttribute('srcdoc', '<b>x</b>'); },
    ];
    for (const write of writes) expect(write).toThrow(TypeError);
    expect(sim.violations).toHaveLength(writes.length);
    expect(div.childNodes.length).toBe(0);
    // A typed value passes, and a plain attribute is no sink.
    div.innerHTML = trustedHtml('<b>typed</b>') as unknown as string;
    frame.setAttribute('title', '<b>x</b>');
    expect(div.innerHTML).toBe('<b>typed</b>');
    expect(frame.getAttribute('title')).toBe('<b>x</b>');
    expect(sim.violations).toHaveLength(writes.length);
  });

  it("core's own writes raise no Trusted Types violation: mount, unmount, the null clear, and every sink given trustedHtml()", () => {
    sim = enforceTrustedTypes();
    const container = document.createElement('div');
    container.append(document.createElement('p'), 'old text');
    document.body.append(container);

    // mount() clears what the container held, unmount() clears what it built.
    const [count, setCount] = createSignal(1);
    const [html, setHtml] = createSignal<{ __html: TrustedHtml } | null>({ __html: trustedHtml('<b>one</b>') });
    const [doc, setDoc] = createSignal<TrustedHtml>(trustedHtml('<p>a</p>'));
    const unmount = mount(() => h('main', null,
      h('span', { id: 'count' }, () => String(count())),
      h('div', { id: 'box', dangerouslySetInnerHTML: () => html() }),
      h('section', { dangerouslySetInnerHTML: { __html: trustedHtml('<em>static</em>') } }),
      h('iframe', { id: 'frame', srcdoc: () => doc() }),
      h('iframe', { srcdoc: trustedHtml('<p>static doc</p>') }),
    ), container);
    expect(container.children).toHaveLength(1);
    expect(container.textContent).not.toContain('old text');
    const box = container.querySelector('#box')!;
    const frame = container.querySelector('#frame')!;
    expect(box.innerHTML).toBe('<b>one</b>');
    expect(container.querySelector('section')!.innerHTML).toBe('<em>static</em>');
    expect(container.querySelectorAll('iframe')[1]!.getAttribute('srcdoc')).toBe('<p>static doc</p>');

    // Three transitions of each reactive raw binding, the null clear among them.
    setHtml(null);
    setDoc(trustedHtml('<p>b</p>'));
    setCount(2);
    expect(box.childNodes.length).toBe(0);
    expect(frame.getAttribute('srcdoc')).toBe('<p>b</p>');
    setHtml({ __html: trustedHtml('<i>two</i>') });
    setDoc(trustedHtml('<p>c</p>'));
    expect(box.innerHTML).toBe('<i>two</i>');
    expect(frame.getAttribute('srcdoc')).toBe('<p>c</p>');
    setHtml(null);
    expect(box.childNodes.length).toBe(0);
    expect(container.querySelector('#count')!.textContent).toBe('2');

    // The other sinks, typed.
    const target = document.createElement('div');
    setHTMLUnsafe(target, trustedHtml('<u>u</u>'));
    expect(target.innerHTML).toBe('<u>u</u>');
    expect((template(trustedHtml('<p class="t">t</p>')).cloneNode(true) as Element).className).toBe('t');
    expect(templateMany(trustedHtml('<a></a><b></b>')).childNodes).toHaveLength(2);

    // The runtime's parser, on all three of its paths: an empty container, a
    // diff of keyed children, and a full replacement.
    const live = document.createElement('div');
    reconcile(live, trustedHtml('<p data-forma-id="a">1</p><p data-forma-id="b">2</p>'));
    reconcile(live, trustedHtml('<p data-forma-id="b">2!</p><p data-forma-id="a">1!</p>'));
    expect(live.textContent).toBe('2!1!');
    reconcile(live, trustedHtml('<p data-forma-id="c">3</p>'));
    expect(live.innerHTML).toBe('<p data-forma-id="c">3</p>');

    unmount();
    expect(container.childNodes.length).toBe(0);
    expect(sim.violations).toEqual([]);
    expect(sim.policies).toEqual(['forma', 'forma-runtime']);
  });

  it('reconcile() parses trusted markup through the forma-runtime policy and a string through no policy', () => {
    sim = enforceTrustedTypes({ reportOnly: true });
    const typed = document.createElement('div');
    reconcile(typed, trustedHtml('  <p>typed</p>\n'));
    expect(typed.innerHTML).toBe('<p>typed</p>');
    // The trimmed markup was minted again by the runtime's own policy.
    expect(sim.minted.map((v) => `${v.policy} ${v.markup}`)).toEqual([
      'forma   <p>typed</p>\n',
      'forma-runtime <p>typed</p>',
    ]);
    expect(sim.violations).toEqual([]);

    // A string is written as a string: the page reports it (Report-Only
    // renders it), and no policy launders it.
    const plain = document.createElement('div');
    reconcile(plain, ' <p>plain</p> ');
    expect(plain.innerHTML).toBe('<p>plain</p>');
    expect(sim.violations).toEqual(['innerHTML <p>plain</p>']);
    expect(sim.minted.map((v) => v.markup)).not.toContain('<p>plain</p>');
    expect(linesWith(warn, 'FORMA_W_RAW_RECONCILE')).toHaveLength(1);
  });

  it("an adopted island's dangerouslySetInnerHTML writes trustedHtml() typed, as content and never as an attribute", () => {
    // FORMA-176: adoption used to write the prop as an attribute.
    sim = enforceTrustedTypes();
    document.body.innerHTML = trustedHtml('<div id="app" data-forma-ssr><article></article></div>') as unknown as string;
    const [inner, setInner] = createSignal<{ __html: TrustedHtml } | null>({ __html: trustedHtml('<b>one</b>') });
    mount(() => h('article', { dangerouslySetInnerHTML: () => inner() }), '#app');
    const article = document.querySelector('article')!;
    expect(article.innerHTML).toBe('<b>one</b>');
    setInner(null);
    expect(article.childNodes.length).toBe(0);
    setInner({ __html: trustedHtml('<b>one</b>') });
    expect(article.innerHTML).toBe('<b>one</b>');
    expect(article.hasAttribute('dangerouslysetinnerhtml')).toBe(false);
    expect(sim.violations).toEqual([]);
  });

  it("adopting a string onto the walker's empty element raises one Trusted Types report, as client rendering does", () => {
    // formajs#32's second review: holdsMarkup parsed the string through a
    // template before writing it, a second report for one write.
    sim = enforceTrustedTypes({ reportOnly: true });
    document.body.innerHTML = trustedHtml('<div id="app" data-forma-ssr><article></article></div>') as unknown as string;
    mount(() => h('article', { dangerouslySetInnerHTML: () => ({ __html: '<b>x</b>' }) }), '#app');
    expect(document.querySelector('#app article')!.innerHTML).toBe('<b>x</b>');
    expect(sim.violations).toEqual(['innerHTML <b>x</b>']);
    // Client rendering, for comparison: one report for one write.
    const client = h('article', { dangerouslySetInnerHTML: () => ({ __html: '<b>x</b>' }) });
    expect(client.innerHTML).toBe('<b>x</b>');
    expect(sim.violations).toEqual(['innerHTML <b>x</b>', 'innerHTML <b>x</b>']);
  });

  it('a refused string does not block the same markup sent later as trustedHtml(), client-rendered and adopted', () => {
    // formajs#32's review (N1): the markup was recorded as current before the
    // write, so after an enforcing page refused it as a string, the same
    // markup as trustedHtml() read as no change and was never written.
    sim = enforceTrustedTypes();
    document.body.innerHTML = trustedHtml('<div id="app" data-forma-ssr><article><b>old</b></article></div>') as unknown as string;
    const [inner, setInner] = createSignal<{ __html: string | TrustedHtml }>({ __html: trustedHtml('<b>old</b>') });
    const client = h('article', { dangerouslySetInnerHTML: () => inner() });
    mount(() => h('article', { dangerouslySetInnerHTML: () => inner() }), '#app');
    const adopted = document.querySelector('#app article')!;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setInner({ __html: '<b>new</b>' });
    expect(adopted.innerHTML).toBe('<b>old</b>');
    expect(client.innerHTML).toBe('<b>old</b>');
    setInner({ __html: trustedHtml('<b>new</b>') });
    expect(adopted.innerHTML).toBe('<b>new</b>');
    expect(client.innerHTML).toBe('<b>new</b>');
    expect(sim.violations).toEqual(['innerHTML <b>new</b>', 'innerHTML <b>new</b>']);
  });

  it("an adopted island's srcdoc binding writes trustedHtml() typed and warns once for a string", () => {
    sim = enforceTrustedTypes({ reportOnly: true });
    document.body.innerHTML = trustedHtml(
      '<div id="app" data-forma-ssr><div><iframe srcdoc="&lt;p&gt;a&lt;/p&gt;"></iframe></div></div>',
    ) as unknown as string;
    const [doc, setDoc] = createSignal<string | TrustedHtml>(trustedHtml('<p>a</p>'));
    mount(() => h('div', null, h('iframe', { srcdoc: () => doc() })), '#app');
    const frame = document.querySelector('iframe')!;
    // Adoption writes nothing where the server agrees.
    expect(frame.getAttribute('srcdoc')).toBe('<p>a</p>');

    setDoc(trustedHtml('<p>b</p>'));
    expect(frame.getAttribute('srcdoc')).toBe('<p>b</p>');
    expect(sim.violations).toEqual([]);
    expect(linesWith(warn, 'FORMA_W_RAW_SRCDOC')).toEqual([]);

    setDoc('<p>c</p>');
    setDoc('<p>d</p>');
    expect(frame.getAttribute('srcdoc')).toBe('<p>d</p>');
    expect(sim.violations).toEqual(['srcdoc <p>c</p>', 'srcdoc <p>d</p>']);
    expect(linesWith(warn, 'FORMA_W_RAW_SRCDOC')).toHaveLength(1);
  });

  it("reconcile()'s diff mints a changed srcdoc of trusted markup and writes no on* or script src", () => {
    // formajs#29's review (S1): patchAttributes copied every changed attribute
    // as a string, so a changed iframe srcdoc, or on* handler, of markup that
    // arrived trusted was refused on an enforcing page.
    sim = enforceTrustedTypes();
    const live = document.createElement('div');
    const markup = (doc: string, handler: string, src: string) => trustedHtml(
      `<div data-forma-id="a"><iframe sandbox="" srcdoc="&lt;p&gt;${doc}&lt;/p&gt;"></iframe>` +
      `<button onclick="${handler}()">x</button><script type="text/x-inert" src="/${src}.js"></script><p title="${doc}">t</p></div>`,
    );
    reconcile(live, markup('one', 'a', 'a'));
    expect(live.querySelector('iframe')!.getAttribute('srcdoc')).toBe('<p>one</p>');

    // The diff path, three times: every TT-sink attribute changes each time.
    for (const [doc, handler, src] of [['two', 'b', 'b'], ['three', 'c', 'c'], ['four', 'd', 'd']] as const) {
      reconcile(live, markup(doc, handler, src));
      expect(live.querySelector('iframe')!.getAttribute('srcdoc'), doc).toBe(`<p>${doc}</p>`);
      // Not a sink: written as before.
      expect(live.querySelector('p')!.getAttribute('title')).toBe(doc);
      // A script attribute is never written: the stale one is gone.
      expect(live.querySelector('button')!.getAttribute('onclick')).toBeNull();
      expect(live.querySelector('script')!.getAttribute('src')).toBeNull();
    }
    expect(sim.violations).toEqual([]);
    expect(sim.minted.filter((v) => v.policy === 'forma-runtime').map((v) => v.markup))
      .toEqual(expect.arrayContaining(['<p>two</p>', '<p>three</p>', '<p>four</p>']));
  });

  it("a string reconcile()'s diff writes a changed on*, script src and srcdoc as 2.0 did", () => {
    // formajs#29's second review (R1): only the diff of trusted markup leaves
    // script attributes unwritten. A string keeps 2.0.3's behaviour (L-18),
    // and its writes are strings, which the page reports.
    sim = enforceTrustedTypes({ reportOnly: true });
    const live = document.createElement('div');
    const markup = (doc: string, handler: string, src: string) =>
      `<div data-forma-id="a"><iframe sandbox="" srcdoc="&lt;p&gt;${doc}&lt;/p&gt;"></iframe>` +
      `<button onclick="${handler}()">x</button><script type="text/x-inert" src="/${src}.js"></script></div>`;
    reconcile(live, markup('one', 'a', 'a'));
    for (const [doc, handler, src] of [['two', 'b', 'b'], ['three', 'c', 'c']] as const) {
      reconcile(live, markup(doc, handler, src));
      expect(live.querySelector('iframe')!.getAttribute('srcdoc'), doc).toBe(`<p>${doc}</p>`);
      expect(live.querySelector('button')!.getAttribute('onclick')).toBe(`${handler}()`);
      expect(live.querySelector('script')!.getAttribute('src')).toBe(`/${src}.js`);
    }
    // Written as strings: the page saw each srcdoc write, and nothing minted it.
    expect(sim.violations.filter((v) => v.startsWith('srcdoc '))).toEqual(['srcdoc <p>two</p>', 'srcdoc <p>three</p>']);
    expect(sim.minted.filter((v) => v.policy === 'forma-runtime')).toEqual([]);
  });

  it('the shared registry holds no policy, and its forma-runtime handle mints nothing from a string', () => {
    // formajs#29's review (S2): the registry held both live policies, so any
    // script could mint a forma-runtime value from a string.
    sim = enforceTrustedTypes();
    const live = document.createElement('div');
    reconcile(live, trustedHtml('<p>made both policies</p>'));
    expect(sim.policies).toEqual(['forma', 'forma-runtime']);

    const reg = (globalThis as Host)[REGISTRY] as Record<string, unknown>;
    expect(Object.getPrototypeOf(reg)).toBeNull();
    // No policy object is reachable from it, at any key or one below (the
    // shape the review found: reg.policies['forma-runtime']).
    const reachable: string[] = [];
    for (const [key, value] of Object.entries(reg)) {
      const inner = value && typeof value === 'object' && !(value instanceof WeakMap) && !(value instanceof Set)
        ? Object.entries(value as object).map(([k, v]) => [`${key}.${k}`, v] as const)
        : [];
      for (const [path, candidate] of [[key, value] as const, ...inner]) {
        if (typeof (candidate as { createHTML?: unknown })?.createHTML === 'function') reachable.push(path);
      }
    }
    expect(reachable).toEqual([]);
    const runtime = reg.runtime as (value: unknown) => RuntimeParser | null;
    const before = sim.minted.length;
    // A string, a look-alike, and Forma's stand-in shape: no parser, no mint.
    expect(runtime('<i id="laundered">no trustedHtml()</i>')).toBeNull();
    expect(runtime({ toString: () => '<i>look-alike</i>' })).toBeNull();
    expect(runtime(new String('<i>boxed</i>'))).toBeNull();
    // A parser made from trusted markup mints only its own iframes' srcdoc.
    const parser = runtime(trustedHtml('<iframe srcdoc="&lt;p&gt;own&lt;/p&gt;"></iframe>'))!;
    // A div's srcdoc is no sink, so any string can be planted on one.
    const foreign = document.createElement('div');
    foreign.setAttribute('srcdoc', '<i>planted</i>');
    expect(parser.srcdoc(foreign)).toBeNull();
    const own = parser.parse().querySelector('iframe')!;
    expect(String(parser.srcdoc(own))).toBe('<p>own</p>');
    // What was minted: the trusted markup (forma, then forma-runtime) and the
    // parser's own srcdoc, nothing from the string or the look-alikes.
    expect(sim.minted.slice(before).map((v) => `${v.policy} ${v.markup}`)).toEqual([
      'forma <iframe srcdoc="&lt;p&gt;own&lt;/p&gt;"></iframe>',
      'forma-runtime <iframe srcdoc="&lt;p&gt;own&lt;/p&gt;"></iframe>',
      'forma-runtime <p>own</p>',
    ]);
    expect(sim.violations).toEqual([]);
  });

  it('a polluted Object.prototype does not stand in for a policy', () => {
    const proto = Object.prototype as Record<string, unknown>;
    proto.forma = () => '<b>polluted</b>';
    proto.runtime = () => null;
    try {
      sim = enforceTrustedTypes();
      const value = trustedHtml('<b>real</b>') as unknown;
      expect(value).toBeInstanceOf(FakeTrustedHTML);
      expect(String(value)).toBe('<b>real</b>');
      const live = document.createElement('div');
      reconcile(live, trustedHtml('<p>real</p>'));
      expect(live.innerHTML).toBe('<p>real</p>');
      expect(sim.violations).toEqual([]);
    } finally {
      delete proto.forma;
      delete proto.runtime;
    }
  });

  it('a reconcile the page refused is not recorded, so the same markup as trustedHtml() is written', () => {
    // formajs#29's review (N3).
    sim = enforceTrustedTypes();
    const live = document.createElement('div');
    live.append(Object.assign(document.createElement('p'), { textContent: 'old' }));
    live.firstElementChild!.setAttribute('data-forma-id', 'old');
    expect(() => reconcile(live, '<p data-forma-id="new">new</p>')).toThrow(TypeError);
    expect(live.textContent).toBe('old');
    reconcile(live, trustedHtml('<p data-forma-id="new">new</p>'));
    expect(live.textContent).toBe('new');
    expect(sim.violations).toEqual(['innerHTML <p data-forma-id="new">new</p>']);
  });

  it('a refused policy name warns once in development, and the sinks then write strings the page refuses', () => {
    // formajs#29's review (N4): another script took the name `forma` first.
    sim = enforceTrustedTypes();
    (globalThis as { trustedTypes?: { createPolicy(n: string, r: object): unknown } })
      .trustedTypes!.createPolicy('forma', { createHTML: (s: string) => s.toUpperCase() });
    const first = trustedHtml('<b>x</b>');
    trustedHtml('<b>y</b>');
    expect(first).not.toBeInstanceOf(FakeTrustedHTML);
    const lines = linesWith(warn, POLICY_REFUSED_CODE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[forma\] FORMA_W_TT_POLICY_REFUSED: .*"forma"/);
    // It fails closed: the stand-in's markup reaches the sink as a string.
    expect(() => h('div', { dangerouslySetInnerHTML: { __html: first } })).toThrow(TypeError);
    expect(sim.violations).toEqual(['trusted-types forma', 'innerHTML <b>x</b>']);
  });

  it('an element named trustedTypes is not Trusted Types', () => {
    // formajs#29's review (N5): DOM clobbering can put an element at
    // window.trustedTypes in an engine without Trusted Types.
    (globalThis as Record<string, unknown>).trustedTypes = document.createElement('a');
    try {
      expect(isTrustedHtml({ toString: () => '<b>x</b>' })).toBe(false);
      const value = trustedHtml('<b>x</b>');
      expect(isTrustedHtml(value)).toBe(true);
      expect(h('div', { dangerouslySetInnerHTML: { __html: value } }).innerHTML).toBe('<b>x</b>');
    } finally {
      delete (globalThis as Record<string, unknown>).trustedTypes;
    }
  });
});

describe('the SSR renderers', () => {
  it("the SSR renderers write a trustedHtml() value's markup and still refuse a non-string", async () => {
    const typed = sh('div', { dangerouslySetInnerHTML: { __html: trustedHtml('<b>typed</b>') } });
    const plain = sh('div', { dangerouslySetInnerHTML: { __html: '<b>plain</b>' } });
    expect(renderToString(typed)).toBe('<div><b>typed</b></div>');
    expect(renderToString(plain)).toBe('<div><b>plain</b></div>');

    let streamed = '';
    for await (const chunk of renderToStream(typed)) streamed += chunk;
    expect(streamed).toContain('<div><b>typed</b></div>');

    const lookAlike = sh('div', { dangerouslySetInnerHTML: { __html: { toString: () => '<b>x</b>' } } });
    expect(() => renderToString(lookAlike)).toThrow('dangerouslySetInnerHTML must be { __html: string }');
  });
});
