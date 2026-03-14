import { describe, it, expect, vi } from 'vitest';
import { createErrorBoundary } from '../error-boundary';
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

describe('createErrorBoundary', () => {
  it('renders children when no error', () => {
    createRoot(() => {
      const frag = createErrorBoundary(
        () => document.createTextNode('success'),
        (err) => document.createTextNode(`Error: ${err.message}`),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('success');
    });
  });

  it('renders fallback when children throw', () => {
    createRoot(() => {
      const frag = createErrorBoundary(
        () => { throw new Error('broken'); },
        (err) => document.createTextNode(`Caught: ${err.message}`),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Caught: broken');
    });
  });

  it('wraps non-Error throws into Error', () => {
    createRoot(() => {
      const frag = createErrorBoundary(
        () => { throw 'string error'; },
        (err) => document.createTextNode(`Caught: ${err.message}`),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Caught: string error');
    });
  });

  it('retry re-runs the try function', () => {
    let attempt = 0;
    createRoot(() => {
      let retryFn: (() => void) | null = null;

      const frag = createErrorBoundary(
        () => {
          attempt++;
          if (attempt === 1) throw new Error('first fail');
          return document.createTextNode('recovered');
        },
        (err, retry) => {
          retryFn = retry;
          return document.createTextNode(`Error (attempt ${attempt})`);
        },
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Error (attempt 1)');

      // Retry should re-run tryFn
      retryFn!();
      expect(getContent(container)).toBe('recovered');
    });
  });
});
