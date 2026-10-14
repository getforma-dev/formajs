/**
 * The zero-build runtime's own `srcdoc` writes (formajs#29's review, S3):
 * `data-bind:srcdoc` and `{item…}` in a list row's `srcdoc` write an
 * expression's value, or a row's data, as a document. No `trustedHtml()` can
 * reach them, so they stay strings, never minted (a page requiring Trusted
 * Types reports or refuses them), and in development they say so once, with
 * their code. 3.0.0 refuses them (FORMA-109).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '../runtime';
import { RUNTIME_SRCDOC_CODE } from '../dom/trusted-html';

const REGISTRY = Symbol.for('@getforma/core#trusted-types');

let root: HTMLElement;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  unmount(root);
  root.remove();
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  vi.restoreAllMocks();
});

/** The console.warn lines that carry `code`. */
const linesWith = (code: string): string[] =>
  (warn.mock.calls as unknown[][]).map((args) => String(args[0])).filter((line) => line.includes(code));

describe('the runtime\'s srcdoc bindings', () => {
  /** Mount `children` under a scope holding `state`, and return the root. */
  function mounted(state: Record<string, unknown>, ...children: Element[]): HTMLElement {
    root = document.createElement('div');
    root.setAttribute('data-forma-state', JSON.stringify(state));
    root.append(...children);
    document.body.append(root);
    mount(root);
    return root;
  }

  /** The one line the runtime's srcdoc bindings log, checked. */
  function expectOneRuntimeLine(): void {
    const lines = linesWith(RUNTIME_SRCDOC_CODE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[forma\] FORMA_W_RAW_RUNTIME_SRCDOC: /);
    expect(lines[0]).toContain('FORMA-109');
    expect(linesWith('FORMA_W_RAW_SRCDOC')).toEqual([]);
  }

  it('data-bind:srcdoc writes its string and warns once with the runtime code', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('data-bind:srcdoc', '{doc}');
    frame.setAttribute('data-bind:title', '{title}');
    const button = document.createElement('button');
    button.setAttribute('data-on:click', "{doc = '<p>changed</p>'}");
    mounted({ doc: '<p>from data</p>', title: 'not a sink' }, frame, button);

    // Written as the string it is, as before, and again when it changes.
    expect(frame.getAttribute('srcdoc')).toBe('<p>from data</p>');
    expect(frame.getAttribute('title')).toBe('not a sink');
    button.click();
    expect(frame.getAttribute('srcdoc')).toBe('<p>changed</p>');
    expectOneRuntimeLine();
  });

  it("a list row's srcdoc writes its string and warns once with the runtime code", () => {
    const list = document.createElement('ul');
    list.setAttribute('data-list', '{rows}');
    const row = document.createElement('li');
    const rowFrame = document.createElement('iframe');
    rowFrame.setAttribute('sandbox', '');
    rowFrame.setAttribute('srcdoc', '{item.d}');
    rowFrame.setAttribute('title', '{item.t}');
    row.append(rowFrame);
    list.append(row);
    mounted({ rows: [{ d: '<p>row one</p>', t: 'one' }, { d: '<p>row two</p>', t: 'two' }] }, list);

    expect([...list.querySelectorAll('iframe')].map((f) => [f.getAttribute('srcdoc'), f.getAttribute('title')]))
      .toEqual([['<p>row one</p>', 'one'], ['<p>row two</p>', 'two']]);
    expectOneRuntimeLine();
  });

  it('a page with no srcdoc binding logs no raw-HTML line', () => {
    root = document.createElement('div');
    root.setAttribute('data-forma-state', JSON.stringify({ title: 'plain', rows: [{ t: 'a' }] }));
    const span = document.createElement('span');
    span.setAttribute('data-bind:title', '{title}');
    const list = document.createElement('ul');
    list.setAttribute('data-list', '{rows}');
    const row = document.createElement('li');
    row.setAttribute('title', '{item.t}');
    list.append(row);
    root.append(span, list);
    document.body.append(root);

    mount(root);

    expect(span.getAttribute('title')).toBe('plain');
    expect(list.querySelector('li')!.getAttribute('title')).toBe('a');
    expect(linesWith('FORMA_W_RAW_')).toEqual([]);
  });
});
