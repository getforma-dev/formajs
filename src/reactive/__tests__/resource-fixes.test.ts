// createResource 1.1.0 fixes: capture synchronously-thrown fetcher errors (and
// keep Suspense balanced), hand the AbortSignal to the fetcher (abort on refetch
// and on dispose), and batch the loading/error start writes (no glitch frame).
import { describe, it, expect } from 'vitest';
import { createResource } from '../resource';
import { internalEffect } from '../effect';
import { createRoot } from '../root';
import { pushSuspenseContext, popSuspenseContext, type SuspenseContext } from '../suspense-context';

describe('createResource 1.1.0 fixes', () => {
  it('captures a synchronously-thrown fetcher error and clears loading', async () => {
    let res: any;
    let escaped: unknown;
    try {
      createRoot(() => {
        res = createResource(
          () => true,
          () => { throw new Error('sync-boom'); },
        );
      });
    } catch (e) { escaped = e; }
    expect(escaped).toBe(undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(res!.error()).toBeInstanceOf(Error);
    expect((res!.error() as Error).message).toBe('sync-boom');
    expect(res!.loading()).toBe(false);
  });

  it('decrements Suspense on a synchronously-thrown fetcher', async () => {
    let pending = 0;
    const ctx: SuspenseContext = {
      increment() { pending++; },
      decrement() { pending--; },
    };
    pushSuspenseContext(ctx);
    try {
      createRoot(() => {
        createResource(() => true, () => { throw new Error('x'); });
      });
    } finally {
      popSuspenseContext();
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(pending).toBe(0);
  });

  it('passes an AbortSignal to the fetcher and aborts it on refetch', () => {
    const signals: AbortSignal[] = [];
    let resource: any;
    createRoot(() => {
      resource = createResource(
        () => true,
        (_src: unknown, info: { signal: AbortSignal }) => {
          signals.push(info.signal);
          return new Promise<string>(() => {}); // never resolves
        },
      );
    });
    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0].aborted).toBe(false);
    resource!.refetch();
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('aborts the in-flight signal when the owning root is disposed', () => {
    const signals: AbortSignal[] = [];
    const dispose = createRoot((d) => {
      createResource(
        () => true,
        (_src: unknown, info: { signal: AbortSignal }) => {
          signals.push(info.signal);
          return new Promise<string>(() => {});
        },
      );
      return d;
    });
    expect(signals[0].aborted).toBe(false);
    dispose();
    expect(signals[0].aborted).toBe(true);
  });

  it('does not expose a glitch frame where loading=true but error is stale', async () => {
    let r: any;
    createRoot(() => {
      r = createResource(() => true, () => Promise.reject(new Error('e1')));
    });
    await new Promise((res) => setTimeout(res, 10));
    expect(r!.loading()).toBe(false);
    expect(r!.error()).toBeInstanceOf(Error);

    const frames: string[] = [];
    createRoot(() => {
      internalEffect(() => {
        frames.push('L=' + String(r!.loading()) + ' E=' + String(r!.error()));
      });
    });
    frames.length = 0;
    r!.refetch();
    expect(frames).toEqual(['L=true E=undefined']);
  });
});
