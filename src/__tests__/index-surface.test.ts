import { describe, expect, it } from 'vitest';
import * as forma from '../index';

describe('public api surface', () => {
  it('exports core reactive and dom primitives', () => {
    expect(typeof forma.createSignal).toBe('function');
    expect(typeof forma.createEffect).toBe('function');
    expect(typeof forma.h).toBe('function');
    expect(typeof forma.Fragment).toBe('symbol');
    expect(typeof forma.mount).toBe('function');
  });

  it('exports server/http/storage entry points', () => {
    expect(typeof forma.$$serverFunction).toBe('function');
    expect(typeof forma.createAction).toBe('function');
    expect(typeof forma.createFetch).toBe('function');
    expect(typeof forma.fetchJSON).toBe('function');
    expect(typeof forma.createLocalStorage).toBe('function');
    expect(typeof forma.createIndexedDB).toBe('function');
  });

  it('does NOT export longestIncreasingSubsequence (internal only)', () => {
    expect((forma as Record<string, unknown>).longestIncreasingSubsequence).toBeUndefined();
  });

  it('does NOT export createValueSignal (removed deprecated alias)', () => {
    expect((forma as Record<string, unknown>).createValueSignal).toBeUndefined();
  });

  it('does NOT export WASM helpers (removed from main entry point)', () => {
    expect((forma as Record<string, unknown>).renderLocal).toBeUndefined();
    expect((forma as Record<string, unknown>).renderIsland).toBeUndefined();
  });
});
