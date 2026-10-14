/**
 * `dangerouslySetInnerHTML` in adoption (FORMA-176; decision brief DR-5, DR-9,
 * DR-19).
 *
 * Adoption used to treat the prop as an attribute: a reactive one wrote
 * `dangerouslysetinnerhtml="[object Object]"` and never touched the content,
 * where client rendering writes the content. And a reactive value going
 * A → null → A left the element empty, in h() as well: the null branch kept
 * A's markup cached, so A again was taken for no change.
 *
 * The server's element comes in two shapes: the Rust walker ships it empty,
 * and `./ssr`'s renderToString writes the markup inside it. Both are adopted
 * to what h() renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal, onError } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';
import { renderToString, sh } from '../../ssr/render';
import { trustedHtml, type TrustedHtml } from '../trusted-html';

const REGISTRY = Symbol.for('@getforma/core#trusted-types');

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  vi.restoreAllMocks();
});

type Inner = { __html: string | TrustedHtml } | null;

/** The two server outputs for `<article id="doc">` holding `markup`. */
const SERVERS = [
  { name: 'the walker (element empty)', html: () => '<article id="doc"></article>' },
  {
    name: './ssr (markup rendered)',
    html: (markup: string) => renderToString(sh('article', { id: 'doc', dangerouslySetInnerHTML: { __html: markup } })),
  },
] as const;

/** Serve `server` in #app and adopt `component` over it; return the adopted element. */
function adopt(server: string, component: () => unknown): Element {
  document.body.innerHTML = `<div id="app" data-forma-ssr>${server}</div>`;
  mount(component as () => HTMLElement, '#app');
  return document.getElementById('doc')!;
}

/** The console.warn lines that carry `code`. */
const linesWith = (code: string): string[] =>
  (warn.mock.calls as unknown[][]).map((args) => String(args[0])).filter((line) => line.includes(code));

describe('dangerouslySetInnerHTML in adoption', () => {
  it.each(SERVERS)('an adopted reactive dangerouslySetInnerHTML shows its content, follows its signal through null and back, and matches client rendering ($name)', (server) => {
    const [inner, setInner] = createSignal<Inner>({ __html: '<b>A</b>' });
    const client = h('article', { id: 'client', dangerouslySetInnerHTML: () => inner() });
    const adopted = adopt(server.html('<b>A</b>'), () => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() }));

    // The same content as the client renders, and the prop is no attribute.
    const same = (): void => {
      expect(adopted.innerHTML).toBe(client.innerHTML);
      expect(adopted.hasAttribute('dangerouslysetinnerhtml')).toBe(false);
    };
    expect(adopted.innerHTML).toBe('<b>A</b>');
    same();
    for (const [next, expected] of [
      [{ __html: '<i>B</i>' }, '<i>B</i>'],
      [null, ''],
      [{ __html: '<b>A</b>' }, '<b>A</b>'],
      [{ __html: trustedHtml('<u>C</u>') }, '<u>C</u>'],
    ] as const) {
      setInner(next);
      expect(adopted.innerHTML, JSON.stringify(next)).toBe(expected);
      same();
    }
  });

  it('A → null → A shows A again, client-rendered and adopted', () => {
    const [inner, setInner] = createSignal<Inner>({ __html: '<b>A</b>' });
    const client = h('article', { dangerouslySetInnerHTML: () => inner() });
    const adopted = adopt('<article id="doc"></article>', () => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() }));
    for (let round = 0; round < 3; round++) {
      setInner(null);
      expect(client.childNodes.length).toBe(0);
      expect(adopted.childNodes.length).toBe(0);
      setInner({ __html: '<b>A</b>' });
      expect(client.innerHTML, `round ${round}`).toBe('<b>A</b>');
      expect(adopted.innerHTML, `round ${round}`).toBe('<b>A</b>');
    }
  });

  it('adoption writes nothing where the server already holds the markup', () => {
    document.body.innerHTML = `<div id="app" data-forma-ssr>${SERVERS[1].html('<b>A</b><i>B</i>')}</div>`;
    const serverChild = document.querySelector('#doc b');
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const [inner, setInner] = createSignal<Inner>({ __html: '<b>A</b><i>B</i>' });
    mount(() => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() }), '#app');
    const records = observer.takeRecords();
    observer.disconnect();
    // The only write is mount() removing data-forma-ssr from its container.
    expect(records.map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`)).toEqual(['attributes:app:data-forma-ssr']);
    expect(document.querySelector('#doc b')).toBe(serverChild);
    // And a change is still written.
    setInner({ __html: '<p>changed</p>' });
    expect(document.getElementById('doc')!.innerHTML).toBe('<p>changed</p>');
  });

  it.each(SERVERS)('a static dangerouslySetInnerHTML is adopted as h() renders it, from either server output ($name)', (server) => {
    const client = h('article', { dangerouslySetInnerHTML: { __html: '<b>static</b>' } });
    const adopted = adopt(server.html('<b>static</b>'), () => h('article', { id: 'doc', dangerouslySetInnerHTML: { __html: '<b>static</b>' } }));
    expect(adopted.innerHTML).toBe('<b>static</b>');
    expect(adopted.innerHTML).toBe(client.innerHTML);
    expect(adopted.hasAttribute('dangerouslysetinnerhtml')).toBe(false);
  });

  it("the server's markup is the prop's content, not children to adopt: no mismatch and no write", () => {
    // The SSR renderers render no children beside the prop, so the element's
    // nodes are its markup; walking them as the descriptor's children would
    // take <b> for the <span> and replace it.
    document.body.innerHTML = `<div id="app" data-forma-ssr>${SERVERS[1].html('<b>A</b>')}</div>`;
    const serverChild = document.querySelector('#doc b');
    const observer = new MutationObserver(() => {});
    observer.observe(document.getElementById('doc')!, { subtree: true, childList: true, attributes: true, characterData: true });
    mount(() => h('article', { id: 'doc', dangerouslySetInnerHTML: { __html: '<b>A</b>' } }, h('span', null, 'kid')), '#app');
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(document.querySelector('#doc b')).toBe(serverChild);
    expect(document.getElementById('doc')!.innerHTML).toBe('<b>A</b>');
    expect(linesWith('Hydration mismatch')).toEqual([]);
  });

  it('adoption writes a string through the raw sink with its development warning, and trustedHtml() with none', () => {
    const [inner, setInner] = createSignal<Inner>({ __html: trustedHtml('<b>typed</b>') });
    const adopted = adopt('<article id="doc"></article>', () => h('article', { id: 'doc', dangerouslySetInnerHTML: () => inner() }));
    expect(adopted.innerHTML).toBe('<b>typed</b>');
    expect(linesWith('FORMA_W_RAW_INNER_HTML')).toEqual([]);
    setInner({ __html: '<i>plain</i>' });
    setInner({ __html: '<i>plain again</i>' });
    expect(adopted.innerHTML).toBe('<i>plain again</i>');
    expect(linesWith('FORMA_W_RAW_INNER_HTML')).toHaveLength(1);
    // A value that is neither is refused, as h() refuses it: the binding's
    // error is reported for both, and the content stays.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = h('article', { dangerouslySetInnerHTML: () => inner() });
    const errors: unknown[] = [];
    const off = onError((err) => { errors.push(err); });
    try {
      setInner({ __html: 7 as unknown as string });
    } finally {
      off();
    }
    expect(errors.map((e) => (e as Error).name)).toEqual(['TypeError', 'TypeError']);
    expect(adopted.innerHTML).toBe('<i>plain again</i>');
    expect(client.innerHTML).toBe('<i>plain again</i>');
  });
});
