/**
 * Client-side attribute-write safety for h().
 *
 * Regression suite for two findings:
 *
 * - `client-url-attr-xss-h`: the client wrote URL attributes with no scheme
 *   check while the SSR renderer dropped them, so an SSR-blocked payload was
 *   re-added the moment the page hydrated.
 * - `client-inline-handler-injection`: `on*` detection was a case-SENSITIVE
 *   charCode test, so `ONCLICK`/`Onerror` skipped addEventListener and reached
 *   setAttribute — which ASCII-lowercases qualified names on HTML elements and
 *   produces a live inline handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'forma/reactive';
import { h, svg } from '../element';
import { renderToString, sh } from '../../ssr/render.js';

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SVG_PAYLOAD = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('h() URL attribute safety', () => {
  it('drops a javascript: href written through h()', () => {
    const el = h('a', { href: 'javascript:alert(1)' }, 'click');
    expect(el.getAttribute('href')).toBeNull();
    expect(el.outerHTML).not.toContain('javascript:');
  });

  it('drops URL schemes obfuscated with control characters', () => {
    const payload = 'java' + String.fromCharCode(0x09) + 'script:alert(1)';
    expect(h('a', { href: payload }).getAttribute('href')).toBeNull();
    expect(h('img', { src: payload }).getAttribute('src')).toBeNull();
    expect(h('form', { action: payload }).getAttribute('action')).toBeNull();
    expect(h('button', { formaction: payload }).getAttribute('formaction')).toBeNull();
    expect(h('video', { poster: payload }).getAttribute('poster')).toBeNull();
    expect(h('body', { background: payload }).getAttribute('background')).toBeNull();
  });

  it('drops javascript: from the object data attribute', () => {
    // `data` was missing from URL_ATTRS entirely, so <object> was unchecked.
    const el = h('object', { data: 'data:text/html,<script>alert(1)</script>' });
    expect(el.getAttribute('data')).toBeNull();
  });

  it('keeps data-* attributes, which are not URL attributes', () => {
    const el = h('div', { 'data-id': 'javascript:not-a-url' });
    expect(el.getAttribute('data-id')).toBe('javascript:not-a-url');
  });

  it('drops data:image/svg+xml on an iframe but keeps it on an img', () => {
    expect(h('iframe', { src: SVG_PAYLOAD }).getAttribute('src')).toBeNull();
    expect(h('img', { src: SVG_PAYLOAD }).getAttribute('src')).toBe(SVG_PAYLOAD);
  });

  it('drops a javascript: src on a reactive binding and removes the stale safe value', () => {
    const [url, setUrl] = createSignal('/safe.png');
    const el = h('img', { src: () => url() });
    expect(el.getAttribute('src')).toBe('/safe.png');

    setUrl('javascript:alert(1)');
    expect(el.getAttribute('src')).toBeNull();

    setUrl('/other.png');
    expect(el.getAttribute('src')).toBe('/other.png');
  });

  it('a refused URL leaves no cache entry that would let the same string through unchecked', () => {
    // handleGenericAttr consults its identity cache BEFORE the URL guard, which
    // is only sound because the reject path stores `null` rather than the
    // refused string. If it ever stored the string, the second write of the
    // same payload would read as a cache hit and skip the guard entirely.
    const [url, setUrl] = createSignal('/safe.png');
    const el = h('img', { src: () => url() });

    setUrl('javascript:alert(1)');
    expect(el.getAttribute('src')).toBeNull();

    // Bounce through a safe value (an equal write would not re-run the binding)
    // and refuse the identical payload again.
    setUrl('/safe.png');
    expect(el.getAttribute('src')).toBe('/safe.png');
    setUrl('javascript:alert(1)');
    expect(el.getAttribute('src')).toBeNull();
  });

  it('runs the URL guard once per distinct value, not once per flush', () => {
    // A reactive href whose value never changes used to pay an allocating
    // String.replace plus two regexes on every flush and then write nothing:
    // 27 ns → 77 ns per write (docs/PERFORMANCE.md § The URL guard runs before
    // the identity cache).
    const PROBE = 'https://example.com/a';
    const [tick, setTick] = createSignal(0);
    const el = h('a', { href: () => { tick(); return PROBE; } });
    expect(el.getAttribute('href')).toBe(PROBE);

    // isDangerousUrl normalizes its input with String.replace before it tests
    // any regex, and it is the only .replace this write path performs on the
    // value, so counting those counts guard runs.
    const original = String.prototype.replace;
    let guardRuns = 0;
    String.prototype.replace = function (this: string, ...args: unknown[]): string {
      if (String(this) === PROBE) guardRuns++;
      return (original as unknown as (...a: unknown[]) => string).apply(this, args);
    } as unknown as typeof String.prototype.replace;
    try {
      for (let i = 1; i <= 5; i++) setTick(i);
    } finally {
      String.prototype.replace = original;
    }

    expect(guardRuns).toBe(0);
    expect(el.getAttribute('href')).toBe(PROBE);
  });

  it('drops a javascript: xlink:href on <use>', () => {
    const staticUse = svg(() => h('use', { 'xlink:href': 'javascript:alert(1)' }));
    expect(staticUse.getAttributeNS(XLINK_NS, 'href')).toBeNull();

    const [href, setHref] = createSignal('#icon');
    const reactiveUse = svg(() => h('use', { 'xlink:href': () => href() }));
    expect(reactiveUse.getAttributeNS(XLINK_NS, 'href')).toBe('#icon');
    setHref('javascript:alert(1)');
    expect(reactiveUse.getAttributeNS(XLINK_NS, 'href')).toBeNull();
  });

  it('keeps ordinary URLs on every guarded attribute', () => {
    expect(h('a', { href: 'https://example.com' }).getAttribute('href')).toBe('https://example.com');
    expect(h('a', { href: '/relative' }).getAttribute('href')).toBe('/relative');
    expect(h('img', { src: 'data:image/png;base64,abc' }).getAttribute('src')).toBe('data:image/png;base64,abc');
    expect(svg(() => h('use', { 'xlink:href': '#icon' })).getAttributeNS(XLINK_NS, 'href')).toBe('#icon');
  });

  it('drops exactly what the SSR renderer drops, so hydration cannot re-add it', () => {
    for (const [tag, attr, value] of [
      ['a', 'href', 'javascript:alert(1)'],
      ['object', 'data', 'data:text/html,<script>alert(1)</script>'],
      ['iframe', 'src', SVG_PAYLOAD],
    ] as const) {
      expect(renderToString(sh(tag, { [attr]: value }))).not.toContain(value);
      expect(h(tag, { [attr]: value }).getAttribute(attr)).toBeNull();
    }
  });
});

describe('h() inline event-handler injection', () => {
  it('drops ONCLICK-cased string props instead of writing an inline handler', () => {
    const el = h('div', { ONCLICK: 'alert(1)', Onerror: 'alert(2)', title: 'ok' });
    expect(el.getAttribute('onclick')).toBeNull();
    expect(el.getAttribute('onerror')).toBeNull();
    expect(el.outerHTML.toLowerCase()).not.toContain('onclick');
    expect(el.outerHTML.toLowerCase()).not.toContain('onerror');
    expect(el.getAttribute('title')).toBe('ok');
  });

  it('drops an uppercase-cased function prop instead of stringifying it into an attribute', () => {
    const el = h('img', { ONERROR: () => 'alert(1)' });
    expect(el.getAttribute('onerror')).toBeNull();
    expect(el.outerHTML.toLowerCase()).not.toContain('onerror');
  });

  it('drops on* props in the value===true branch', () => {
    const el = h('div', { ONFOCUS: true });
    expect(el.getAttribute('onfocus')).toBeNull();
    expect(el.outerHTML.toLowerCase()).not.toContain('onfocus');
  });

  it('still binds lowercase on* props as real listeners', () => {
    const onClick = vi.fn();
    const el = h('button', { onClick }, 'go');
    el.dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(el.getAttribute('onclick')).toBeNull();
  });

  it('warns in dev when a prop is dropped', () => {
    h('div', { ONCLICK: 'alert(1)' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ONCLICK'));
  });
});

describe('h() raw-HTML attributes', () => {
  it('emits srcdoc but warns that escaping does not neutralize it', () => {
    const el = h('iframe', { srcdoc: '<p>trusted</p>', sandbox: '' });
    // Deliberately NOT blocked: a sandboxed srcdoc iframe is a legitimate pattern.
    expect(el.getAttribute('srcdoc')).toBe('<p>trusted</p>');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('raw-HTML sink'));
  });
});
