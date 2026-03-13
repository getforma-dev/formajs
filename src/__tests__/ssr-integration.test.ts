import { describe, expect, it } from 'vitest';
import {
  renderToStream,
  renderToString,
  renderToStringWithHydration,
  sh,
  shSuspense,
  ssrSignal,
} from '../ssr';

describe('ssr integration', () => {
  it('renders vnode trees and signal getters to string', () => {
    const [count] = ssrSignal(3);
    const html = renderToString(
      sh('div', { className: 'card' }, 'Count: ', () => count()),
    );

    expect(html).toBe('<div class="card">Count: 3</div>');
  });

  it('injects hydration markers in hydration render mode', () => {
    const html = renderToStringWithHydration(
      sh('section', null, sh('h1', null, 'Title'), () => 'dynamic'),
    );

    expect(html).toContain('data-forma-h="');
    expect(html).toContain('<!--forma-t:');
  });

  it('streams fallback first and swap payload after suspense resolves', async () => {
    const stream = renderToStream(
      sh(
        'main',
        null,
        'before',
        shSuspense(
          sh('span', null, 'Loading...'),
          async () => sh('span', null, 'Resolved!'),
        ),
        'after',
      ),
    );

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const output = chunks.join('');

    expect(output).toContain('$FORMA_SWAP');
    expect(output).toContain('Loading...');
    expect(output).toContain('Resolved!');
    expect(output).toContain('forma-s:0');
  });
});
