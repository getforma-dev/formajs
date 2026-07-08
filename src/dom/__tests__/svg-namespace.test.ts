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
