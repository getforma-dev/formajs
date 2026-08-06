/**
 * Island activation: error isolation, props-block trust, and teardown.
 *
 * Regression suite for:
 * - `island-shared-props-parse-unguarded` / `islands-script-parse-not-isolated`
 *   (a bare JSON.parse of `#__forma_islands`, located by id alone, outside the
 *   per-island try/catch: one bad block stopped EVERY island hydrating, and any
 *   element with that id could supply props to all of them)
 * - `hydrate-error-path-zombie-effects` (a failed island kept its effects alive
 *   forever, with no handle left for deactivateIsland to reach them)
 * - `activate-islands-no-shadow-root-param` (islands in a ShadowRoot could be
 *   deactivated but never activated)
 * - `sanitize-props-shallow-no-opt-in-deep` (no supported way to sanitize deeply)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEffect, createSignal } from 'forma/reactive';
import { activateIslands, deactivateIsland, sanitizePropsDeep } from '../activate';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('shared __forma_islands props block', () => {
  it('a malformed __forma_islands block does not stop islands from hydrating', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div>
      <div data-forma-island="1" data-forma-component="B" data-forma-props='{"inline":true}' data-forma-status="pending"><p>1</p></div>
      <script id="__forma_islands" type="application/json">{"0":{"broken":</script>
    `;

    const a = vi.fn();
    const b = vi.fn();
    activateIslands({ A: a, B: b });

    // Both islands hydrate; the one whose props came from the broken block just
    // gets null instead of taking the whole page down with it.
    expect(a).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]![1]).toBeNull();
    expect(b).toHaveBeenCalledWith(expect.anything(), { inline: true });
    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('active');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('active');
  });

  it('an empty __forma_islands script block degrades to null props', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div>
      <script id="__forma_islands" type="application/json"></script>
    `;

    const a = vi.fn();
    activateIslands({ A: a });

    expect(a).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('ignores a non-script element carrying id __forma_islands', () => {
    // A user-controlled node (a comment body, a profile field) with this id used
    // to supply props to every island on the page.
    document.body.innerHTML = `
      <div id="__forma_islands">{"0":{"role":"admin"}}</div>
      <div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div>
    `;

    const a = vi.fn();
    activateIslands({ A: a });

    expect(a).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('still reads props from a real script block', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="A" data-forma-status="pending"><p>0</p></div>
      <script id="__forma_islands" type="application/json">{"0":{"title":"hello"}}</script>
    `;

    const a = vi.fn();
    activateIslands({ A: a });

    expect(a).toHaveBeenCalledWith(expect.anything(), { title: 'hello' });
  });
});

describe('failed island teardown', () => {
  it('disposes effects created before a failing island threw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Boom" data-forma-status="pending"><p>x</p></div>
    `;

    const [count, setCount] = createSignal(0);
    let runs = 0;

    activateIslands({
      Boom: () => {
        createEffect(() => { count(); runs++; });
        throw new Error('kaboom');
      },
    });

    const island = document.querySelector('[data-forma-island]')!;
    expect(island.getAttribute('data-forma-status')).toBe('error');
    expect(runs).toBe(1);

    // A zombie island keeps re-running its bindings on every shared-signal write.
    setCount(1);
    expect(runs).toBe(1);
    // Nothing is left dangling for deactivateIsland to find.
    expect((island as unknown as { __formaDispose?: unknown }).__formaDispose).toBeUndefined();
    expect(() => deactivateIsland(island as HTMLElement)).not.toThrow();
  });

  it('keeps a successful island reactive and disposable', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Ok" data-forma-status="pending"><p>x</p></div>
    `;

    const [count, setCount] = createSignal(0);
    let runs = 0;

    activateIslands({ Ok: () => { createEffect(() => { count(); runs++; }); } });

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(island.getAttribute('data-forma-status')).toBe('active');
    setCount(1);
    expect(runs).toBe(2);

    deactivateIsland(island);
    setCount(2);
    expect(runs).toBe(2);
    expect(island.getAttribute('data-forma-status')).toBe('disposed');
  });
});

describe('activateIslands root parameter', () => {
  it('activates islands inside a shadow root when one is passed as root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div data-forma-island="0" data-forma-component="Shadowed" data-forma-status="pending"><p>in shadow</p></div>
    `;

    const fn = vi.fn();
    // document.querySelectorAll does not pierce shadow roots, so the default
    // root finds nothing at all.
    activateIslands({ Shadowed: fn });
    expect(fn).not.toHaveBeenCalled();

    activateIslands({ Shadowed: fn }, shadow);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shadow.querySelector('[data-forma-island]')?.getAttribute('data-forma-status')).toBe('active');

    host.remove();
  });

  it('falls back to the document props block for a shadow subtree', () => {
    document.body.innerHTML = `<script id="__forma_islands" type="application/json">{"7":{"from":"page"}}</script>`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div data-forma-island="7" data-forma-component="Shadowed" data-forma-status="pending"><p>x</p></div>
    `;

    const fn = vi.fn();
    activateIslands({ Shadowed: fn }, shadow);

    expect(fn).toHaveBeenCalledWith(expect.anything(), { from: 'page' });
    host.remove();
  });
});

describe('sanitizePropsDeep', () => {
  it('sanitizePropsDeep strips forbidden keys at every depth', () => {
    const props = JSON.parse(
      '{"a":{"b":{"__proto__":{"isAdmin":true},"keep":1}},"list":[{"constructor":{"x":1},"ok":2}]}',
    );

    const out = sanitizePropsDeep(props);

    const nested = out.a.b as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(false);
    expect(nested['keep']).toBe(1);
    const row = out.list[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(row, 'constructor')).toBe(false);
    expect(row['ok']).toBe(2);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  it('sanitizePropsDeep terminates on cyclic props', () => {
    const a: Record<string, unknown> = JSON.parse('{"__proto__":{"isAdmin":true},"name":"a"}');
    a['self'] = a;

    expect(() => sanitizePropsDeep(a)).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(a, '__proto__')).toBe(false);
    expect(a['name']).toBe('a');
  });

  it('is opt-in: island activation still sanitizes only the top level', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="A"
           data-forma-props='{"__proto__":{"x":1},"nested":{"__proto__":{"y":2},"keep":3}}'
           data-forma-status="pending"><p>x</p></div>
    `;

    const fn = vi.fn();
    activateIslands({ A: fn });

    const props = fn.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(props, '__proto__')).toBe(false);
    const nested = props['nested'] as Record<string, unknown>;
    // Documented limitation: the default pass is shallow, which is exactly why
    // sanitizePropsDeep exists as an explicit opt-in.
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sanitizePropsDeep(nested), '__proto__')).toBe(false);
  });
});
