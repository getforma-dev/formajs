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

  it('exports state and event primitives', () => {
    expect(typeof forma.createStore).toBe('function');
    expect(typeof forma.createHistory).toBe('function');
    expect(typeof forma.createBus).toBe('function');
    expect(typeof forma.createReducer).toBe('function');
  });

  it('exports island management', () => {
    expect(typeof forma.activateIslands).toBe('function');
    expect(typeof forma.deactivateIsland).toBe('function');
    expect(typeof forma.deactivateAllIslands).toBe('function');
  });

  it('exports reactive introspection (alien-signals 3.x)', () => {
    expect(typeof forma.isSignal).toBe('function');
    expect(typeof forma.isComputed).toBe('function');
    expect(typeof forma.getBatchDepth).toBe('function');
    expect(typeof forma.trigger).toBe('function');
  });

  it('does NOT export HTTP primitives (moved to @getforma/core/http)', () => {
    expect((forma as Record<string, unknown>).createFetch).toBeUndefined();
    expect((forma as Record<string, unknown>).fetchJSON).toBeUndefined();
    expect((forma as Record<string, unknown>).createSSE).toBeUndefined();
    expect((forma as Record<string, unknown>).createWebSocket).toBeUndefined();
  });

  it('does NOT export storage primitives (moved to @getforma/core/storage)', () => {
    expect((forma as Record<string, unknown>).createLocalStorage).toBeUndefined();
    expect((forma as Record<string, unknown>).createSessionStorage).toBeUndefined();
    expect((forma as Record<string, unknown>).createIndexedDB).toBeUndefined();
  });

  it('does NOT export server primitives (moved to @getforma/core/server)', () => {
    expect((forma as Record<string, unknown>).$$serverFunction).toBeUndefined();
    expect((forma as Record<string, unknown>).createAction).toBeUndefined();
    expect((forma as Record<string, unknown>).handleRPC).toBeUndefined();
    expect((forma as Record<string, unknown>).registerServerFunction).toBeUndefined();
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
