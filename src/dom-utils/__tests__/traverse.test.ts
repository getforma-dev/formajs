import { describe, it, expect } from 'vitest';
import { closest, children, siblings, parent, nextSibling, prevSibling } from '../traverse';

function buildTree() {
  const root = document.createElement('div');
  root.className = 'root';
  const ul = document.createElement('ul');
  ul.className = 'list';
  const li1 = document.createElement('li');
  li1.className = 'item first';
  li1.textContent = 'A';
  const li2 = document.createElement('li');
  li2.className = 'item';
  li2.textContent = 'B';
  const li3 = document.createElement('li');
  li3.className = 'item last';
  li3.textContent = 'C';
  ul.appendChild(li1);
  ul.appendChild(li2);
  ul.appendChild(li3);
  root.appendChild(ul);
  return { root, ul, li1, li2, li3 };
}

describe('closest', () => {
  it('finds ancestor matching selector', () => {
    const { root, li1 } = buildTree();
    document.body.appendChild(root);
    expect(closest(li1, '.root')).toBe(root);
    document.body.removeChild(root);
  });

  it('returns null when no match', () => {
    const { root, li1 } = buildTree();
    document.body.appendChild(root);
    expect(closest(li1, '.nonexistent')).toBe(null);
    document.body.removeChild(root);
  });
});

describe('children', () => {
  it('returns all children', () => {
    const { ul, li1, li2, li3 } = buildTree();
    expect(children(ul)).toEqual([li1, li2, li3]);
  });

  it('filters by selector', () => {
    const { ul, li1 } = buildTree();
    expect(children(ul, '.first')).toEqual([li1]);
  });

  it('returns empty for no children', () => {
    const el = document.createElement('div');
    expect(children(el)).toEqual([]);
  });
});

describe('siblings', () => {
  it('returns all siblings excluding self', () => {
    const { root, ul, li1, li2, li3 } = buildTree();
    document.body.appendChild(root);

    const sibs = siblings(li2);
    expect(sibs).toContain(li1);
    expect(sibs).toContain(li3);
    expect(sibs).not.toContain(li2);

    document.body.removeChild(root);
  });

  it('filters siblings by selector', () => {
    const { root, ul, li2, li3 } = buildTree();
    document.body.appendChild(root);

    const sibs = siblings(li2, '.last');
    expect(sibs).toEqual([li3]);

    document.body.removeChild(root);
  });

  it('returns empty for element with no parent', () => {
    const el = document.createElement('div');
    expect(siblings(el)).toEqual([]);
  });
});

describe('parent', () => {
  it('returns parent element', () => {
    const { ul, li1 } = buildTree();
    expect(parent(li1)).toBe(ul);
  });

  it('returns null for detached element', () => {
    const el = document.createElement('div');
    expect(parent(el)).toBe(null);
  });
});

describe('nextSibling', () => {
  it('returns next sibling', () => {
    const { li1, li2 } = buildTree();
    expect(nextSibling(li1)).toBe(li2);
  });

  it('returns null at the end', () => {
    const { li3 } = buildTree();
    expect(nextSibling(li3)).toBe(null);
  });

  it('filters by selector', () => {
    const { li1, li3 } = buildTree();
    expect(nextSibling(li1, '.last')).toBe(li3);
  });
});

describe('prevSibling', () => {
  it('returns previous sibling', () => {
    const { li1, li2 } = buildTree();
    expect(prevSibling(li2)).toBe(li1);
  });

  it('returns null at the start', () => {
    const { li1 } = buildTree();
    expect(prevSibling(li1)).toBe(null);
  });

  it('filters by selector', () => {
    const { li1, li3 } = buildTree();
    expect(prevSibling(li3, '.first')).toBe(li1);
  });
});
