import { describe, it, expect, vi } from 'vitest';
import { onError, reportError, __DEV__ } from '../dev';

describe('onError supports multiple subscribers and unsubscribe (1.1.0)', () => {
  it('invokes every registered handler', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onError(a);
    const offB = onError(b);
    const err = new Error('boom');
    reportError(err, 'effect');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toBe(err);
    offA();
    offB();
  });

  it('unsubscribe removes only that handler', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onError(a);
    const offB = onError(b);
    offA();
    reportError(new Error('x'), 'effect');
    expect(a).toHaveBeenCalledTimes(0);
    expect(b).toHaveBeenCalledTimes(1);
    offB();
  });
});

/**
 * The console fallback is gated on `__DEV__`, which is decided ONCE — at build
 * time in every published artifact, at module-load time when the source is
 * consumed raw. It used to call `isDev()` per report, re-reading
 * `process.env.NODE_ENV` on every error; that is what shipped dev logging into
 * any production process that left NODE_ENV unset. See src/reactive/dev.ts.
 */
describe('reportError console fallback is decided once, not per call (1.1.0)', () => {
  /** Reset the duplicate-instance registry so a fresh import does not warn. */
  const INSTANCE_KEY = Symbol.for('@getforma/core#instances');
  const clearInstances = (): void => {
    delete (globalThis as unknown as Record<symbol, unknown>)[INSTANCE_KEY];
  };

  it('does not log when the module was loaded with NODE_ENV=production', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    clearInstances();
    vi.resetModules();
    try {
      const prod = await import('../dev.js');
      expect(prod.__DEV__).toBe(false);
      prod.reportError(new Error('prod'), 'effect');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
      spy.mockRestore();
      clearInstances();
      vi.resetModules();
    }
  });

  it('logs in development', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // This suite runs against raw source with NODE_ENV unset, so __DEV__ is true.
      expect(__DEV__).toBe(true);
      reportError(new Error('dev'), 'effect');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores a NODE_ENV change made after the module loaded', () => {
    // Deliberate: a per-call environment read is what the fix removed. A build
    // that fixed __DEV__ to false cannot be talked back into logging, and a dev
    // build cannot be silenced by mutating the environment mid-flight.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      reportError(new Error('late'), 'effect');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = prev;
      spy.mockRestore();
    }
  });
});
