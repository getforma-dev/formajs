// F3 (1.3.0): a Suspense whose resolved content is a DocumentFragment must not
// duplicate or lose content across re-suspend/re-resolve.
import { describe, it, expect } from 'vitest';
import { createSuspense } from '../suspense';
import { createResource } from '../../reactive/resource';
import { createSignal } from '../../reactive/signal';
import { createRoot } from '../../reactive/root';

function contentText(container: HTMLElement): string {
  let text = '';
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 8) continue; // skip comment markers
    text += node.textContent ?? '';
  }
  return text;
}

describe('createSuspense fragment re-suspend (F3)', () => {
  it('does not duplicate or lose resolved fragment content across re-suspend', async () => {
    let container!: HTMLElement;
    let setSrc!: (v: number) => void;

    createRoot(() => {
      const [src, _setSrc] = createSignal(1);
      setSrc = _setSrc;
      const frag = createSuspense(
        () => document.createTextNode('LOADING'),
        () => {
          createResource(() => src(), (n: number) => Promise.resolve('R' + String(n)));
          const f = document.createDocumentFragment();
          const a = document.createElement('span');
          a.textContent = 'A';
          const b = document.createElement('span'); // empty second node
          f.appendChild(a);
          f.appendChild(b);
          return f;
        },
      );
      container = document.createElement('div');
      container.appendChild(frag);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(contentText(container)).toBe('A');

    setSrc(2); // re-fetch -> re-suspend -> fallback
    expect(contentText(container)).toBe('LOADING');
    expect(container.querySelectorAll('span').length).toBe(0);

    await new Promise((r) => setTimeout(r, 20)); // re-resolve
    expect(contentText(container)).toBe('A');
    expect(container.querySelectorAll('span').length).toBe(2);
    expect(contentText(container).indexOf('LOADING')).toBe(-1);
  });

  it('single Text-node resolved content still round-trips through re-suspend', async () => {
    let container!: HTMLElement;
    let setSrc!: (v: number) => void;

    createRoot(() => {
      const [src, _setSrc] = createSignal(1);
      setSrc = _setSrc;
      const frag = createSuspense(
        () => document.createTextNode('LOADING'),
        () => {
          createResource(() => src(), (n: number) => Promise.resolve(n));
          return document.createTextNode('DONE');
        },
      );
      container = document.createElement('div');
      container.appendChild(frag);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(contentText(container)).toBe('DONE');
    setSrc(2);
    expect(contentText(container)).toBe('LOADING');
    await new Promise((r) => setTimeout(r, 20));
    expect(contentText(container)).toBe('DONE');
  });
});
