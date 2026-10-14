// SVG namespace context (1.3.0): dual-use tags (<a>) resolve to SVG inside svg().
import { describe, it, expect } from 'vitest';
import { h, svg } from '../element';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

describe('h() SVG dual-use tag namespace (1.3.0)', () => {
  it('h(a) with NO svg context stays HTML (no regression)', () => {
    const el = h('a') as Element;
    expect(el.namespaceURI).toBe(XHTML);
    expect(el).toBeInstanceOf(HTMLAnchorElement);
  });

  it('<a> built inside svg() context gets the SVG namespace', () => {
    const root = svg(() => h('svg', { viewBox: '0 0 10 10' }, h('a', { href: '#x' }))) as Element;
    expect(root.namespaceURI).toBe(SVG);
    const anchor = root.querySelector('a')!;
    expect(anchor.namespaceURI).toBe(SVG);
  });

  it('nested SVG-only children inside svg() keep SVG namespace', () => {
    const root = svg(() => h('svg', null, h('g', null, h('path', { d: 'M0 0L1 1' })))) as Element;
    expect(root.querySelector('path')!.namespaceURI).toBe(SVG);
    expect(root.querySelector('g')!.namespaceURI).toBe(SVG);
  });

  it('svg() restores context so a later plain h(a) is HTML again', () => {
    svg(() => h('svg', null, h('a')));
    const after = h('a') as Element;
    expect(after.namespaceURI).toBe(XHTML);
  });

  it('restores context even if build throws', () => {
    expect(() => svg(() => { throw new Error('boom'); })).toThrow('boom');
    expect((h('a') as Element).namespaceURI).toBe(XHTML);
  });
});

// Client rendering of the icon FORMA-020 adopts: what h() builds must be what
// the browser's parser builds from the server's markup (DR-9).
describe('client-rendered SVG matches the parsed server markup (FORMA-020)', () => {
  const namespaces = (root: Element) =>
    [root, ...Array.from(root.querySelectorAll('*'))].map((el) => `${el.localName}:${el.namespaceURI}`);

  it('h() creates an svg and its SVG-only children in the SVG namespace without svg()', () => {
    const root = h('svg', { viewBox: '0 0 10 10' },
      h('defs', null, h('clipPath', { id: 'c' }, h('rect', { width: '5' })), h('linearGradient', { id: 'g' }, h('stop'))),
      h('g', null, h('path', { d: 'M0 0L10 10' }), h('circle', { r: '1' })),
    ) as Element;
    expect(namespaces(root).every((entry) => entry.endsWith(`:${SVG}`))).toBe(true);
    expect(namespaces(root).map((entry) => entry.split(':')[0])).toEqual(
      ['svg', 'defs', 'clipPath', 'rect', 'linearGradient', 'stop', 'g', 'path', 'circle'],
    );
  });

  it('an icon built in svg() has the namespaces and markup the parser gives the server HTML', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg viewBox="0 0 10 10"><title>Close</title><path d="M0 0L10 10"></path></svg>';
    const parsed = host.firstElementChild!;
    const built = svg(() => h('svg', { viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('path', { d: 'M0 0L10 10' }))) as Element;
    expect(namespaces(built)).toEqual(namespaces(parsed));
    expect(namespaces(built)).toEqual([`svg:${SVG}`, `title:${SVG}`, `path:${SVG}`]);
    expect(built.outerHTML).toBe(parsed.outerHTML);
  });
});
