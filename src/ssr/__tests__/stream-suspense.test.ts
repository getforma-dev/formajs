import { describe, it, expect } from 'vitest';
import { renderToStream, shSuspense, sh } from '../index';

// Collect all chunks from the async generator into one string.
async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let result = '';
  for await (const chunk of stream) {
    result += chunk;
  }
  return result;
}

describe('renderToStream suspenseTimeout (S1)', () => {
  it('terminates the stream (does not hang) when a Suspense never settles', async () => {
    const stream = renderToStream(
      sh(
        'main',
        null,
        'before',
        shSuspense(
          sh('span', null, 'Loading...'),
          // Never-settling async resource.
          () => new Promise<never>(() => {}),
        ),
        'after',
      ),
      { suspenseTimeout: 20 },
    );

    // Guard: if the generator hangs, this whole promise never resolves and
    // the test times out. We race it against a watchdog to assert completion.
    let done = false;
    const collected = collectStream(stream).then((out) => {
      done = true;
      return out;
    });
    const watchdog = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('stream did not terminate')), 500),
    );

    const output = await Promise.race([collected, watchdog]);
    expect(done).toBe(true);
    // Fallback stays visible.
    expect(output).toContain('Loading...');
    expect(output).toContain('forma-s:0');
    // No swap was emitted for the timed-out boundary. The bootstrap always
    // DEFINES `function $FORMA_SWAP(id,html)`; an emitted swap is a CALL
    // `$FORMA_SWAP("forma-s:0", ...)`, so check for the call form.
    expect(output).not.toContain('$FORMA_SWAP("');
  });

  it('still swaps when the boundary resolves within the timeout', async () => {
    const stream = renderToStream(
      sh(
        'main',
        null,
        shSuspense(
          sh('span', null, 'Loading...'),
          async () => sh('span', null, 'Resolved!'),
        ),
      ),
      { suspenseTimeout: 500 },
    );
    const output = await collectStream(stream);
    expect(output).toContain('$FORMA_SWAP');
    expect(output).toContain('Resolved!');
  });
});

describe('renderToStream nested Suspense in resolved content (S2)', () => {
  it('resolves a nested Suspense inside resolved content via a swap (not literal)', async () => {
    const stream = renderToStream(
      sh(
        'main',
        null,
        shSuspense(
          sh('span', null, 'Outer loading...'),
          async () =>
            sh(
              'section',
              null,
              'outer-resolved ',
              shSuspense(
                sh('span', null, 'Inner loading...'),
                async () => sh('span', null, 'Inner resolved!'),
              ),
            ),
        ),
      ),
    );

    const output = await collectStream(stream);

    // Outer boundary swaps in.
    expect(output).toContain('forma-s:0');
    expect(output).toContain('outer-resolved');
    // The nested boundary must NOT be emitted as a literal element.
    expect(output).not.toContain('<forma-suspense');
    // It must be resolved via its own swap and its content must appear.
    expect(output).toContain('forma-s:1');
    expect(output).toContain('Inner resolved!');
    // Two distinct swap scripts were emitted.
    const swapCount = output.split('$FORMA_SWAP').length - 1;
    expect(swapCount).toBeGreaterThanOrEqual(2);
  });
});