import { describe, it, expect } from 'vitest';
import { createContext, provide, inject, unprovide } from '../context';

describe('createContext', () => {
  it('creates a context with a default value', () => {
    const ctx = createContext('light');
    expect(ctx.defaultValue).toBe('light');
    expect(typeof ctx.id).toBe('symbol');
  });

  it('each context has a unique id', () => {
    const a = createContext(1);
    const b = createContext(2);
    expect(a.id).not.toBe(b.id);
  });

  it('supports any type as default value', () => {
    const num = createContext(42);
    const obj = createContext({ theme: 'dark' });
    const arr = createContext([1, 2, 3]);
    const nul = createContext(null);

    expect(num.defaultValue).toBe(42);
    expect(obj.defaultValue).toEqual({ theme: 'dark' });
    expect(arr.defaultValue).toEqual([1, 2, 3]);
    expect(nul.defaultValue).toBe(null);
  });
});

describe('inject', () => {
  it('returns default when no provider is active', () => {
    const ctx = createContext('fallback');
    expect(inject(ctx)).toBe('fallback');
  });
});

describe('provide / inject', () => {
  it('injects the provided value', () => {
    const ctx = createContext('light');
    provide(ctx, 'dark');
    expect(inject(ctx)).toBe('dark');
    unprovide(ctx); // cleanup
  });

  it('nested provide overrides outer value', () => {
    const ctx = createContext('default');
    provide(ctx, 'outer');
    expect(inject(ctx)).toBe('outer');

    provide(ctx, 'inner');
    expect(inject(ctx)).toBe('inner');

    unprovide(ctx);
    expect(inject(ctx)).toBe('outer');

    unprovide(ctx);
    expect(inject(ctx)).toBe('default');
  });

  it('multiple contexts are independent', () => {
    const themeCtx = createContext('light');
    const langCtx = createContext('en');

    provide(themeCtx, 'dark');
    provide(langCtx, 'es');

    expect(inject(themeCtx)).toBe('dark');
    expect(inject(langCtx)).toBe('es');

    unprovide(themeCtx);
    expect(inject(themeCtx)).toBe('light');
    expect(inject(langCtx)).toBe('es');

    unprovide(langCtx);
  });

  it('supports object values', () => {
    const ctx = createContext({ count: 0 });
    const provided = { count: 42 };
    provide(ctx, provided);
    expect(inject(ctx)).toBe(provided);
    unprovide(ctx);
  });
});

describe('unprovide', () => {
  it('restores previous value after unprovide', () => {
    const ctx = createContext(0);
    provide(ctx, 1);
    provide(ctx, 2);
    provide(ctx, 3);

    expect(inject(ctx)).toBe(3);
    unprovide(ctx);
    expect(inject(ctx)).toBe(2);
    unprovide(ctx);
    expect(inject(ctx)).toBe(1);
    unprovide(ctx);
    expect(inject(ctx)).toBe(0);
  });

  it('is a no-op when nothing was provided', () => {
    const ctx = createContext('default');
    // Should not throw
    expect(() => unprovide(ctx)).not.toThrow();
    expect(inject(ctx)).toBe('default');
  });

  it('cleans up empty stacks (no memory leak)', () => {
    const ctx = createContext(0);
    provide(ctx, 1);
    unprovide(ctx);
    // After removing the last value, inject should return default
    expect(inject(ctx)).toBe(0);
    // Providing again should still work
    provide(ctx, 99);
    expect(inject(ctx)).toBe(99);
    unprovide(ctx);
  });
});
