/**
 * THE SHARED RENDERER CONTRACT.
 *
 * FormaJS writes attributes and text through six independent code paths, and
 * every one of them must uphold the same guarantees:
 *
 *   1. `src/ssr/render.ts`   — `renderToString()` (server, string output)
 *   2. `src/dom/element.ts`  — `h()` with static props
 *   3. `src/dom/element.ts`  — `h()` with reactive (function) props
 *   4. `src/dom/hydrate.ts`  — `applyDynamicProps()` / `adoptNode()` (adoption)
 *   5. `src/runtime.ts`      — the HTML runtime's `data-bind:*` / `data-text`
 *   6. `src/expr/interp.ts`  — `$el.setAttribute()` in the CSP-safe grammar
 *
 * Historically each guarantee was asserted thoroughly on exactly ONE of them.
 * That single habit produced 7 of the 25 code defects in
 * `docs/archive/2026-08-05-hardening-audit.md`, including the only non-documentation Critical
 * (`client-url-attr-xss-h`: `h('a', {href:'javascript:alert(1)'})` emitted the
 * attribute verbatim while the SSR path had blocked it since day one) — and,
 * when this file was written, two more that no per-path suite could see:
 *
 *   - `$el.setAttribute()` in the expression interpreter was the only attribute
 *     sink in the repo with no safety guard at all, so a CSP-safe handler could
 *     write the `javascript:` href that `data-bind:href` refuses 20 lines away.
 *   - `data-bind:` wrote `name="true"` where the other four wrote a bare
 *     attribute, so an SSR page and its hydrated self disagreed byte-for-byte.
 *
 * So the assertions live HERE, parameterised over the paths, and never in one
 * path's file. When a new renderer or sink is added it joins `SINKS`, or the
 * test "every module that writes an attribute is represented in SINKS" fails.
 *
 * The boolean-attribute rows are a CROSS-IMPLEMENTATION contract: the Rust
 * walker in `forma` renders `true` as a bare attribute name, and a page that is
 * server-rendered by Rust and then bound by this runtime has to agree.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { h } from '../dom/element';
import { applyDynamicProps, adoptNode } from '../dom/hydrate';
import { renderToString, sh } from '../ssr/render.js';
import { mount, unmount } from '../runtime';
import { URL_ATTRS } from '../security/url-safety';
import { compileHandler, runHandler } from '../expr/index';
import { hostObject } from '../expr/host';
import type { ScopeLike } from '../expr/interp';

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const SOH = String.fromCharCode(0x01);

/**
 * URLs that must never reach a URL-bearing attribute. Three are obfuscated the
 * way browsers permit: ASCII whitespace and C0 controls are stripped before the
 * scheme is resolved, so `java\tscript:` executes.
 */
const DANGEROUS_URLS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  `java${TAB}script:alert(1)`,
  `java${LF}script:alert(1)`,
  `${SOH}javascript:alert(1)`,
  '   javascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
] as const;

/**
 * The negative space. `DANGEROUS_SCHEME_RE` is anchored with `^`; drop the
 * anchor and it becomes a substring match that blocks every one of these.
 * Without these rows that mutation is invisible, because every hostile fixture
 * in the repo is a URL that *should* be blocked.
 */
const SAFE_URLS = [
  'https://example.com/guides/javascript',
  '/relative/javascript-guide',
  '?q=vbscript',
  '#javascript',
  'data:image/png;base64,iVBORw0KGgo=',
  'mailto:someone@example.com',
] as const;

/** Every casing an `on…` name can arrive in. Detection is case-INSENSITIVE. */
const EVENT_HANDLER_ATTRS = ['onclick', 'ONCLICK', 'Onerror', 'onMouseOver'] as const;

/** A tag each URL attribute legitimately appears on. */
const ATTR_TAG: Record<string, string> = {
  href: 'a',
  src: 'img',
  action: 'form',
  formaction: 'button',
  poster: 'video',
  background: 'table',
  data: 'object',
  'xlink:href': 'use',
};

const SVG_DATA_URL =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';

/** The benign sibling every "we block X" row renders alongside X (rule P3). */
const BENIGN_ATTR = 'title';
const BENIGN_VALUE = 'kept';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

// ---------------------------------------------------------------------------
// The sinks
// ---------------------------------------------------------------------------

interface Sink {
  name: string;
  /**
   * Write `name=value` and `title="kept"` onto a fresh `<tag>`, and return the
   * element that results (for SSR, the element parsed back out of the markup).
   */
  write(tag: string, name: string, value: unknown): Element;
  /** Render `text` as the element's only child. */
  writeText(tag: string, text: string): Element;
  /**
   * False when the sink takes its attribute names from HTML source, so a name
   * that is not a legal HTML attribute name cannot be expressed at all.
   */
  programmaticNames: boolean;
  /**
   * False for the imperative escape hatch: `$el.setAttribute(name, true)` is the
   * DOM method, and the DOM stringifies. The declarative renderers are the ones
   * that owe the bare-attribute contract.
   */
  declarative: boolean;
}

const containers: HTMLElement[] = [];
const disposers: Array<() => void> = [];

function host(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  containers.push(el);
  return el;
}

/** Run `fn` in an owned reactive root that this file's afterEach disposes. */
function owned<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** Parse SSR markup back into a live element so every sink reads the same way. */
function parse(html: string): Element {
  const box = host();
  box.innerHTML = html;
  const el = box.firstElementChild;
  if (!el) throw new Error(`SSR produced no element: ${JSON.stringify(html)}`);
  return el;
}

/** Read an attribute by qualified name, including the xlink namespace. */
function readAttr(el: Element, name: string): string | null {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  if (name.startsWith('xlink:')) return el.getAttributeNS(XLINK_NS, name.slice(6));
  return null;
}

/** Attribute names on `el` that a browser would treat as inline event handlers. */
function liveHandlerAttrs(el: Element): string[] {
  return [...el.attributes].map((a) => a.name).filter((n) => /^on/i.test(n));
}

/**
 * JSON for a `data-forma-state` attribute written with single quotes. `&` has
 * to be escaped FIRST: the HTML parser entity-decodes attribute values, so a
 * payload containing `&lt;` would otherwise reach the runtime as `<` and the
 * fixture would be testing a different string than the one it declared.
 */
function stateAttr(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
}

/** A scope with `$el` bound, matching what `src/runtime.ts` injects. */
function exprScope(state: Record<string, unknown>, el: Element): ScopeLike {
  const getters: Record<string, () => unknown> = Object.create(null);
  const setters: Record<string, (v: unknown) => void> = Object.create(null);
  for (const k of Object.keys(state)) {
    getters[k] = () => state[k];
    setters[k] = (v) => { state[k] = v; };
  }
  getters.$el = () => hostObject('element', el, '$el');
  return { getters, setters };
}

const SINKS: Sink[] = [
  {
    name: 'ssr',
    programmaticNames: true,
    declarative: true,
    write: (tag, name, value) =>
      parse(renderToString(sh(tag, { [name]: value, [BENIGN_ATTR]: BENIGN_VALUE }))),
    writeText: (tag, text) => parse(renderToString(sh(tag, null, text))),
  },
  {
    name: 'h-static',
    programmaticNames: true,
    declarative: true,
    write: (tag, name, value) => h(tag, { [name]: value, [BENIGN_ATTR]: BENIGN_VALUE }),
    writeText: (tag, text) => h(tag, null, text),
  },
  {
    name: 'h-reactive',
    programmaticNames: true,
    declarative: true,
    write: (tag, name, value) =>
      owned(() => h(tag, { [name]: () => value, [BENIGN_ATTR]: () => BENIGN_VALUE })),
    writeText: (tag, text) => owned(() => h(tag, null, () => text)),
  },
  {
    name: 'adopt',
    programmaticNames: true,
    declarative: true,
    write: (tag, name, value) =>
      owned(() => {
        // Adoption only ever binds FUNCTION props: static ones are already in
        // the server HTML. The element it adopts is the server's own output.
        const el = parse(renderToString(sh(tag, null)));
        applyDynamicProps(el, { [name]: () => value, [BENIGN_ATTR]: () => BENIGN_VALUE });
        return el;
      }),
    writeText: (tag, text) =>
      owned(() => {
        // The SSR shape a text marker adopts: <!--f:t0-->text<!--/f:t0-->.
        const el = parse(`<${tag}><!--f:t0-->placeholder<!--/f:t0--></${tag}>`);
        adoptNode({ type: 'element', tag, props: null, children: [(): string => text] }, el);
        return el;
      }),
  },
  {
    name: 'data-bind',
    programmaticNames: false,
    declarative: true,
    write: (tag, name, value) => {
      const box = host();
      box.innerHTML =
        `<div data-forma-state='${stateAttr({ v: value, b: BENIGN_VALUE })}'>` +
        `<${tag} id="probe" data-bind:${name}="{v}" data-bind:${BENIGN_ATTR}="{b}"></${tag}>` +
        `</div>`;
      mount(box);
      const el = box.querySelector('#probe');
      if (!el) throw new Error(`data-bind fixture produced no <${tag}>`);
      return el;
    },
    writeText: (tag, text) => {
      const box = host();
      box.innerHTML =
        `<div data-forma-state='${stateAttr({ t: text })}'>` +
        `<${tag} id="probe" data-text="{t}"></${tag}></div>`;
      mount(box);
      return box.querySelector('#probe')!;
    },
  },
  {
    name: '$el.setAttribute',
    programmaticNames: true,
    declarative: false,
    write: (tag, name, value) => {
      const el = document.createElement(tag);
      host().appendChild(el);
      const scope = exprScope({ n: name, v: value, bn: BENIGN_ATTR, bv: BENIGN_VALUE }, el);
      // Two statements: the hostile write, then a benign write on the same
      // element. If refusing the first tore the element down, or left the
      // interpreter unusable, the benign write would not land either (P3).
      try {
        runHandler(compileHandler('$el.setAttribute(n, v)'), scope);
      } catch {
        /* a refusal surfaces as a denial; the page must still bind below */
      }
      runHandler(compileHandler('$el.setAttribute(bn, bv)'), scope);
      return el;
    },
    writeText: (tag, text) => {
      const el = document.createElement(tag);
      host().appendChild(el);
      runHandler(compileHandler('$el.textContent = t'), exprScope({ t: text }, el));
      return el;
    },
  },
];

const NAME_SINKS = SINKS.filter((s) => s.programmaticNames);
const DECLARATIVE_SINKS = SINKS.filter((s) => s.declarative);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) dispose();
  for (const box of containers.splice(0)) {
    unmount(box);
    box.remove();
  }
});

// ---------------------------------------------------------------------------
// Completeness — a new sink joins the table or this fails
// ---------------------------------------------------------------------------

describe('renderer contract: the table covers every sink', () => {
  it('lists exactly the sinks this contract claims to cover', () => {
    expect(SINKS.map((s) => s.name)).toEqual([
      'ssr',
      'h-static',
      'h-reactive',
      'adopt',
      'data-bind',
      '$el.setAttribute',
    ]);
  });

  it('every module that writes an attribute is represented in SINKS', () => {
    // The mechanism that stops this table going stale. Any production module
    // that calls setAttribute/setAttributeNS/toggleAttribute either writes
    // attributes on a caller's behalf — and must be a row above — or is listed
    // here with the reason it is not a sink.
    const ROOT = process.cwd();
    const NON_SINKS: Record<string, string> = {
      'src/dom-utils/mutate.ts': 'setAttr() helper — covered by mutate.test.ts',
      'src/dom/activate.ts': 'writes only data-forma-* status, a fixed internal name',
      'src/dom/list.ts': 'copies attributes DOM→DOM between two already-guarded elements',
      'src/dom/reconcile.ts': 'copies attributes DOM→DOM between two already-guarded elements',
    };
    const DOM_SINK_FILES = [
      'src/dom/element.ts',
      'src/dom/hydrate.ts',
      'src/runtime.ts',
      'src/expr/interp.ts',
      'src/expr/allowlist.ts',
    ];
    /** The only module that assembles an attribute into a markup STRING. */
    const MARKUP_SINK_FILES = ['src/ssr/render.ts'];

    const domWriters: string[] = [];
    const markupWriters: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__') walk(p);
        } else if (/\.ts$/.test(name)) {
          const rel = relative(ROOT, p).replace(/\\/g, '/');
          const text = readFileSync(p, 'utf8');
          if (/setAttribute(NS)?\(|toggleAttribute\(|'setAttribute'/.test(text)) domWriters.push(rel);
          if (/escapeAttr\(/.test(text)) markupWriters.push(rel);
        }
      }
    };
    walk(resolve(ROOT, 'src'));

    const unaccounted = [...domWriters, ...markupWriters].filter(
      (f) => !DOM_SINK_FILES.includes(f) && !MARKUP_SINK_FILES.includes(f) && !Object.hasOwn(NON_SINKS, f),
    );
    expect(
      unaccounted,
      'a new attribute-writing module must join SINKS above (or NON_SINKS with a reason)',
    ).toEqual([]);
    // And the list may not rot: every file named above still writes attributes.
    for (const f of [...DOM_SINK_FILES, ...Object.keys(NON_SINKS)]) {
      expect(domWriters, `${f} no longer writes attributes — remove it from the list`).toContain(f);
    }
    for (const f of MARKUP_SINK_FILES) {
      expect(markupWriters, `${f} no longer emits attribute markup`).toContain(f);
    }
  });

  it('covers every URL-bearing attribute the security module declares', () => {
    // Allowlists are tested for COMPLETENESS, not contents: deleting 'poster'
    // or 'background' from URL_ATTRS used to be invisible because only href and
    // src were ever exercised.
    expect(Object.keys(ATTR_TAG).sort()).toEqual([...URL_ATTRS].sort());
  });
});

// ---------------------------------------------------------------------------
// G1 — dangerous URLs are refused on every sink, on every URL attribute
// ---------------------------------------------------------------------------

describe.each(SINKS)('renderer contract [$name]: dangerous URLs', (sink) => {
  it.each([...URL_ATTRS])('drops every script scheme written to %s', (attr) => {
    for (const url of DANGEROUS_URLS) {
      const el = sink.write(ATTR_TAG[attr]!, attr, url);
      expect(readAttr(el, attr), `${JSON.stringify(url)} on ${attr}`).toBeNull();
      // …and the element still carries its benign attribute (P3): "we dropped
      // everything" must not be able to read as "we blocked the payload".
      expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
    }
  });

  it.each([...URL_ATTRS])('keeps ordinary URLs on %s', (attr) => {
    for (const url of SAFE_URLS) {
      const el = sink.write(ATTR_TAG[attr]!, attr, url);
      expect(readAttr(el, attr), `${url} on ${attr}`).toBe(url);
      expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
    }
  });

  it('keeps data:image/svg+xml on an image sink and drops it on a document sink', () => {
    // The value is inert through an image decoder and a live document through
    // <a href>/<object data>, so the guard is only able to judge it if the sink
    // forwards the element's tag.
    expect(readAttr(sink.write('img', 'src', SVG_DATA_URL), 'src')).toBe(SVG_DATA_URL);
    expect(readAttr(sink.write('a', 'href', SVG_DATA_URL), 'href')).toBeNull();
    expect(readAttr(sink.write('object', 'data', SVG_DATA_URL), 'data')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G2 — event-handler attribute names are refused on every sink
// ---------------------------------------------------------------------------

describe.each(SINKS)('renderer contract [$name]: inline event handlers', (sink) => {
  it.each(EVENT_HANDLER_ATTRS)('never writes %s as an attribute', (name) => {
    const el = sink.write('div', name, 'alert(1)');
    // setAttribute ASCII-lowercases qualified names on HTML elements, so the
    // lower-case form is the one that would actually fire.
    expect(el.getAttribute(name.toLowerCase())).toBeNull();
    expect(liveHandlerAttrs(el)).toEqual([]);
    expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
  });

  it('a refused handler attribute does not become a live listener', () => {
    delete (globalThis as Record<string, unknown>).__formaPwned;
    const el = sink.write('button', 'onclick', 'globalThis.__formaPwned = true');
    el.dispatchEvent(new Event('click'));
    expect((globalThis as Record<string, unknown>).__formaPwned).toBeUndefined();
  });

  it.each([[true], [''], [0], [1]])('refuses an on* name whatever the value type: %j', (value) => {
    // Value TYPE matters, not just value content. Several sinks special-case
    // `true` into a bare-attribute write that runs before the URL/handler
    // predicate, so `ONCLICK: () => true` takes a different branch from
    // `ONCLICK: () => 'alert(1)'` and needs its own row.
    const el = sink.write('div', 'ONCLICK', value);
    expect(el.getAttribute('onclick')).toBeNull();
    expect(liveHandlerAttrs(el)).toEqual([]);
    expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
  });
});

// ---------------------------------------------------------------------------
// G3 — attribute names that would break out of the attribute position
// ---------------------------------------------------------------------------

/**
 * Names that would break OUT of the attribute position — they contain the
 * characters an attacker needs to start a second attribute or close the tag.
 * Every sink that takes a programmatic name must refuse these.
 */
const BREAKOUT_NAMES = [
  'foo bar',
  'foo"bar',
  "foo'bar",
  'foo=bar',
  'foo<bar',
  'foo>bar',
  'a/b',
] as const;

/**
 * Names that cannot break out but are outside the well-formed charset. Only the
 * sinks whose NAME can come from runtime data have to police these: `ssr`
 * interpolates the name into markup, and `$el.setAttribute(k, v)` takes `k`
 * from an expression that can read state. Everywhere else the key is a literal
 * in author code and the DOM is the backstop.
 */
const MALFORMED_NAMES = ['2leading', '-leading', '.leading'] as const;

const DATA_NAME_SINKS = SINKS.filter((s) => s.name === 'ssr' || s.name === '$el.setAttribute');

describe.each(DATA_NAME_SINKS)(
  'renderer contract [$name]: attribute names taken from data',
  (sink) => {
    it.each(MALFORMED_NAMES)('refuses the malformed name %j', (name) => {
      let el: Element | null = null;
      let threw = false;
      try {
        el = sink.write('div', name, 'x');
      } catch {
        threw = true;
      }
      if (!threw) {
        expect(el!.getAttribute(name)).toBeNull();
        expect(readAttr(el!, BENIGN_ATTR)).toBe(BENIGN_VALUE);
      }
    });
  },
);

describe.each(NAME_SINKS)('renderer contract [$name]: attribute-name safety', (sink) => {
  it.each(BREAKOUT_NAMES)('refuses the name %j without emitting it', (name) => {
    let el: Element | null = null;
    let threw = false;
    try {
      el = sink.write('div', name, 'x');
    } catch {
      // A DOM sink may fail closed with InvalidCharacterError. Refusing loudly
      // is acceptable; silently emitting the name is not.
      threw = true;
    }
    if (!threw) {
      expect(el!.getAttribute(name)).toBeNull();
      expect(el!.outerHTML).not.toContain(name);
      expect(readAttr(el!, BENIGN_ATTR)).toBe(BENIGN_VALUE);
    }
  });

  it.each(['data-x', 'aria-label', 'xml:lang', '_private', 'a.b', 'x-1'])(
    'keeps the well-formed name %s',
    (name) => {
      const el = sink.write('div', name, 'ok');
      expect(readAttr(el, name)).toBe('ok');
    },
  );
});

// ---------------------------------------------------------------------------
// G4 — boolean attribute semantics (the cross-implementation contract)
// ---------------------------------------------------------------------------

describe.each(DECLARATIVE_SINKS)('renderer contract [$name]: boolean attributes', (sink) => {
  it('true renders a bare attribute — present with an empty value', () => {
    // The Rust walker in `forma` renders `true` as a bare attribute name.
    // Parsed back, a bare attribute reads as the empty string, so this is the
    // one form all five declarative paths and the walker must agree on.
    const el = sink.write('input', 'disabled', true);
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.getAttribute('disabled')).toBe('');
  });

  it('false omits the attribute entirely', () => {
    const el = sink.write('input', 'disabled', false);
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
  });

  it('null omits the attribute entirely', () => {
    const el = sink.write('input', 'disabled', null);
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(readAttr(el, BENIGN_ATTR)).toBe(BENIGN_VALUE);
  });

  it('the empty string renders present-and-empty, not omitted', () => {
    const el = sink.write('input', 'value', '');
    expect(el.hasAttribute('value')).toBe(true);
    expect(el.getAttribute('value')).toBe('');
  });

  it('a non-empty string renders verbatim', () => {
    const el = sink.write('input', 'value', 'hello');
    expect(el.getAttribute('value')).toBe('hello');
  });
});

describe('renderer contract [$el.setAttribute]: is the DOM method, deliberately', () => {
  it('stringifies its second argument the way setAttribute does', () => {
    // Documented divergence from the four declarative paths above: this is the
    // imperative escape hatch, and it may not silently rewrite what the author
    // passed. The SAFETY guards still apply to it — see the tables above.
    const el = document.createElement('input');
    host().appendChild(el);
    runHandler(compileHandler('$el.setAttribute(n, v)'), exprScope({ n: 'disabled', v: true }, el));
    expect(el.getAttribute('disabled')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// G5 — text is text on every sink
// ---------------------------------------------------------------------------

const TEXT_PAYLOADS = [
  '<script>alert(1)</script>',
  '</div><img src=x onerror=alert(1)>',
  '5 > 3 && 2 < 4',
  `it's a "quote" & an ampersand`,
  '<!-- not a comment -->',
  '&lt;already escaped&gt;',
] as const;

describe.each(SINKS)('renderer contract [$name]: text is never markup', (sink) => {
  it.each(TEXT_PAYLOADS)('renders %j as text', (payload) => {
    const el = sink.writeText('div', payload);
    expect(el.textContent).toBe(payload);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    // No parsed markup at all: the payload produced zero child ELEMENTS.
    expect([...el.childNodes].filter((n) => n.nodeType === 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SSR exact output — the string form, asserted whole
// ---------------------------------------------------------------------------

describe('renderer contract: SSR emits exactly these bytes', () => {
  // `render.ts` scored worst in the repo on mutation detection almost entirely
  // because its assertions were `toContain` fragments. A fragment assertion
  // cannot see an attribute that was dropped, a quote that was not escaped, or
  // a `>` that arrived early. These are whole-output assertions.

  it('escapes every HTML metacharacter in a text child', () => {
    expect(renderToString(sh('p', null, `<a href="x">&'`))).toBe(
      '<p>&lt;a href=&quot;x&quot;&gt;&amp;&#x27;</p>',
    );
  });

  it('escapes every HTML metacharacter in an attribute value', () => {
    expect(renderToString(sh('a', { title: `" onmouseover=x "` }))).toBe(
      '<a title="&quot; onmouseover=x &quot;"></a>',
    );
    expect(renderToString(sh('a', { title: `<>&'` }))).toBe(
      '<a title="&lt;&gt;&amp;&#39;"></a>',
    );
  });

  it('escapes & first, so an escape is never double-decoded', () => {
    // `&lt;` in the source must survive as `&amp;lt;`, not decay to `<`.
    expect(renderToString(sh('p', null, '&lt;script&gt;'))).toBe('<p>&amp;lt;script&amp;gt;</p>');
    expect(renderToString(sh('p', { title: '&quot;' }))).toBe('<p title="&amp;quot;"></p>');
  });

  it('drops the dangerous attribute and keeps every benign one, in order', () => {
    expect(
      renderToString(sh('a', { id: 'ok', href: 'javascript:alert(1)', title: 'safe' }, 'click')),
    ).toBe('<a id="ok" title="safe">click</a>');
  });

  it('renders true as a bare attribute and omits false and null', () => {
    expect(renderToString(sh('input', { disabled: true, checked: false, name: null, id: 'x' })))
      .toBe('<input disabled id="x" />');
  });

  it('closes void elements and never gives them children', () => {
    expect(renderToString(sh('br', null))).toBe('<br />');
    expect(renderToString(sh('img', { src: '/a.png' }, 'ignored'))).toBe('<img src="/a.png" />');
    expect(renderToString(sh('div', null, 'kept'))).toBe('<div>kept</div>');
  });

  it('maps the JSX prop aliases to their HTML attribute names', () => {
    expect(renderToString(sh('label', { className: 'a', htmlFor: 'x', tabIndex: 2 }))).toBe(
      '<label class="a" for="x" tabindex="2"></label>',
    );
  });

  it('never serialises a ref prop into the markup, whatever the callback returns', () => {
    // The idiomatic ref is an arrow with an implicit return —
    // `ref={(el) => (this.node = el)}` evaluates to the assigned element — so a
    // `ref` that reached the prop loop would be CALLED and its result
    // stringified into an attribute. A void ref hides that: the result is
    // `undefined`, which the null check drops for an unrelated reason.
    let called = 0;
    const ref = (): string => { called += 1; return 'LEAKED'; };
    expect(renderToString(sh('div', { ref, id: 'x' }))).toBe('<div id="x"></div>');
    expect(called, 'a ref must not be invoked during server rendering').toBe(0);
  });

  it('drops a whole element whose tag name would inject markup', () => {
    expect(renderToString(sh('div onload=alert(1)', { id: 'x' }, 'hi'))).toBe('');
    expect(renderToString(sh('div', null, sh('a><script', null, 'x'), 'after'))).toBe(
      '<div>after</div>',
    );
  });

  it('resolves signal getters in both attributes and children', () => {
    const [n, setN] = createSignal(1);
    const tree = (): unknown => sh('p', { 'data-n': () => n() }, () => `n=${n()}`);
    expect(renderToString(tree())).toBe('<p data-n="1">n=1</p>');
    setN(2);
    expect(renderToString(tree())).toBe('<p data-n="2">n=2</p>');
  });

  it('renders nested trees, arrays and numbers without stray separators', () => {
    expect(
      renderToString(
        sh('ul', { class: 'l' }, [sh('li', null, 1), sh('li', null, 'two')], null, false, 'tail'),
      ),
    ).toBe('<ul class="l"><li>1</li><li>two</li>tail</ul>');
  });
});
