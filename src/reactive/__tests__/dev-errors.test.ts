import { describe, it, expect, vi } from 'vitest';
import { onError, reportError } from '../dev';

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

describe('reportError dev guard is lazy and production-safe (1.1.0)', () => {
  it('does not log to console.error when NODE_ENV=production and no handler', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      reportError(new Error('prod'), 'effect');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
      spy.mockRestore();
    }
  });

  it('still logs in development', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      reportError(new Error('dev'), 'effect');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = prev;
      spy.mockRestore();
    }
  });
});
