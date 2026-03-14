import { describe, it, expect } from 'vitest';
import { $, $$ } from '../query';

describe('$ (querySelector)', () => {
  it('finds an element by selector', () => {
    const div = document.createElement('div');
    div.id = 'test-q1';
    document.body.appendChild(div);

    expect($('#test-q1')).toBe(div);
    document.body.removeChild(div);
  });

  it('returns null when not found', () => {
    expect($('#nonexistent-element-xyz')).toBe(null);
  });

  it('scopes query to parent node', () => {
    const container = document.createElement('div');
    const inner = document.createElement('span');
    inner.className = 'target';
    container.appendChild(inner);

    const outside = document.createElement('span');
    outside.className = 'target';
    document.body.appendChild(outside);
    document.body.appendChild(container);

    const result = $('.target', container);
    expect(result).toBe(inner);

    document.body.removeChild(outside);
    document.body.removeChild(container);
  });
});

describe('$$ (querySelectorAll)', () => {
  it('returns array of matching elements', () => {
    const container = document.createElement('div');
    const a = document.createElement('p');
    a.className = 'item';
    const b = document.createElement('p');
    b.className = 'item';
    container.appendChild(a);
    container.appendChild(b);
    document.body.appendChild(container);

    const result = $$('.item', container);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);

    document.body.removeChild(container);
  });

  it('returns empty array when no matches', () => {
    expect($$('.nonexistent-class-xyz')).toEqual([]);
  });
});
