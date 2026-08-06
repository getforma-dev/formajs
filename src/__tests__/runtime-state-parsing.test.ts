/**
 * `data-forma-state` parsing, observed the only way that matters: through what
 * the page ends up bound to.
 *
 * This file replaces src/__tests__/runtime-parsestate.test.ts, which asserted
 * `expect(el).toBeTruthy()` on markup its own helper had just written — eight
 * tests that could not fail, and did not call the runtime at all. Every test
 * here reads a rendered `data-text` binding or a real prototype, so breaking
 * parseState breaks the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getScopes, mount, unmount } from '../runtime';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount(container);
  container.remove();
});

/**
 * The state keys a scope actually came up with, via the DevTools inspector.
 * `$refetch` and `$refs` are injected for every scope and are not state.
 */
const INJECTED_MAGICS = new Set(['$refetch', '$refs']);

function stateKeysOf(el: Element): string[] {
  const scope = getScopes().find((s) => s.element === el);
  return Object.keys(scope?.values ?? {})
    .filter((k) => !INJECTED_MAGICS.has(k))
    .sort();
}

function mountState(state: string): Element {
  container.innerHTML = `<div data-forma-state='${state}'></div>`;
  mount(container);
  return container.firstElementChild!;
}

/** Mount `state` as a scope and return what `data-text="{key}"` rendered. */
async function textFor(state: string, key = 'value'): Promise<string | null | undefined> {
  container.innerHTML = `
    <div data-forma-state='${state}'>
      <p id="out" data-text="{${key}}"></p>
    </div>`;
  mount(container);
  await tick();
  return container.querySelector('#out')?.textContent;
}

describe('data-forma-state parsing', () => {
  it('binds every key of a valid JSON object', async () => {
    expect(await textFor('{"value": 41, "other": "x"}')).toBe('41');
    expect(await textFor('{"value": "Alice"}')).toBe('Alice');
  });

  it('keeps a URL value intact, colons and all', async () => {
    // The parser this replaced ran a regex over the raw attribute to allow
    // unquoted keys; it matched the colon in `https://` and corrupted the value.
    expect(await textFor('{"value": "https://example.com/api?a=1"}')).toBe(
      'https://example.com/api?a=1',
    );
  });

  it('treats unquoted keys as empty state rather than guessing', async () => {
    expect(await textFor('{value: 41}')).toBe('');
  });

  it('treats unparseable input as empty state', async () => {
    expect(await textFor('not json at all')).toBe('');
    expect(await textFor('')).toBe('');
    expect(await textFor('{}')).toBe('');
  });

  it('treats every non-object JSON value as empty state', () => {
    // All of these parse successfully — they are simply not a scope. An array
    // used to bind its indices as state keys named "0" and "1".
    for (const raw of ['null', '7', '"hello"', 'true', '[1,2]', '[]']) {
      expect(stateKeysOf(mountState(raw)), raw).toEqual([]);
      unmount(container);
    }
    // …and a real object still produces its keys, so the guard is not a blanket.
    expect(stateKeysOf(mountState('{"a":1,"b":2}'))).toEqual(['a', 'b']);
  });

  it('a JSON scalar in data-forma-state does not stop the rest of the page from binding', async () => {
    // The regression this pins: `'__proto__' in "hello"` is a TypeError, and it
    // was thrown from inside mount(), so ONE bad attribute unbound the document.
    container.innerHTML = `
      <div data-forma-state='"hello"'><p id="bad" data-text="{value}"></p></div>
      <div data-forma-state='{"value": "still here"}'><p id="good" data-text="{value}"></p></div>`;

    expect(() => mount(container)).not.toThrow();
    await tick();

    expect(container.querySelector('#bad')?.textContent).toBe('');
    expect(container.querySelector('#good')?.textContent).toBe('still here');
  });

  it('a __proto__ key in data-forma-state never reaches Object.prototype', async () => {
    try {
      const text = await textFor('{"__proto__": {"polluted": "yes"}, "value": "clean"}');
      expect(text).toBe('clean');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('polluted');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('drops constructor and prototype keys but keeps ordinary ones', async () => {
    expect(await textFor('{"constructor": "hijack", "value": "kept"}', 'constructor')).toBe('');
    expect(await textFor('{"prototype": "hijack", "value": "kept"}', 'prototype')).toBe('');
    expect(await textFor('{"constructor": "hijack", "value": "kept"}')).toBe('kept');
  });

  it('an expression naming an Object.prototype member reads undefined, not the prototype', async () => {
    // The scope's getter table is null-prototype. When it was a `{}` literal,
    // `{constructor}` resolved to `Object` — and the parser calls what it finds,
    // so the binding rendered `[object Object]` from a scope that declared no
    // such key.
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      expect(await textFor('{"value": 1}', name), name).toBe('');
    }
  });

  it('keeps a state key that shadows an Object.prototype member', async () => {
    // The null prototype must not cost the app a legitimate key name.
    expect(await textFor('{"toString": "mine"}', 'toString')).toBe('mine');
    expect(await textFor('{"hasOwnProperty": "mine"}', 'hasOwnProperty')).toBe('mine');
  });
});
