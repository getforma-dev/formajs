import { describe, it, expect } from 'vitest';
import { createSuspense } from '../suspense';
import { createResource } from '../../reactive/resource';
import { createSignal } from '../../reactive/signal';
import { createRoot } from '../../reactive/root';

function mountFragment(frag: DocumentFragment): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(frag);
  return container;
}

function getContent(container: HTMLElement): string {
  let text = '';
  for (const node of container.childNodes) {
    if (node.nodeType === 8) continue;
    text += node.textContent ?? '';
  }
  return text;
}

describe('createSuspense', () => {
  it('shows fallback while resource is loading', () => {
    createRoot(() => {
      const frag = createSuspense(
        () => document.createTextNode('Loading...'),
        () => {
          createResource(
            () => true,
            () => new Promise(() => {}), // never resolves
          );
          return document.createTextNode('Content');
        },
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Loading...');
    });
  });

  it('swaps to children after resource resolves', async () => {
    let container: HTMLElement;
    createRoot(() => {
      const frag = createSuspense(
        () => document.createTextNode('Loading...'),
        () => {
          createResource(
            () => true,
            () => Promise.resolve('data'),
          );
          return document.createTextNode('Resolved');
        },
      );
      container = mountFragment(frag);
    });

    // Wait for async resolution
    await new Promise(r => setTimeout(r, 20));
    expect(getContent(container!)).toBe('Resolved');
  });

  it('returns DocumentFragment with comment markers', () => {
    createRoot(() => {
      const frag = createSuspense(
        () => document.createTextNode('...'),
        () => document.createTextNode('ok'),
      );
      expect(frag).toBeInstanceOf(DocumentFragment);
    });
  });
});
