import { describe, it, expect } from 'vitest';
import { template, templateMany } from '../template';

describe('template', () => {
  it('creates a node from HTML string', () => {
    const node = template('<div>hello</div>');
    expect(node.nodeName.toLowerCase()).toBe('div');
    expect(node.textContent).toBe('hello');
  });

  it('caches templates — same HTML returns same node', () => {
    const a = template('<span>cached</span>');
    const b = template('<span>cached</span>');
    expect(a).toBe(b);
  });

  it('different HTML returns different nodes', () => {
    const a = template('<p>one</p>');
    const b = template('<p>two</p>');
    expect(a).not.toBe(b);
  });

  it('returned node should be cloned for use', () => {
    const proto = template('<div class="tmpl"></div>');
    const clone = proto.cloneNode(true) as HTMLElement;
    expect(clone).not.toBe(proto);
    expect((clone as HTMLElement).className).toBe('tmpl');
  });
});

describe('templateMany', () => {
  it('creates DocumentFragment from multi-root HTML', () => {
    const frag = templateMany('<span>A</span><span>B</span>');
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });

  it('each call returns a fresh clone', () => {
    const a = templateMany('<p>x</p>');
    const b = templateMany('<p>x</p>');
    expect(a).not.toBe(b);
  });
});
