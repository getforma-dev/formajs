/**
 * Shared fixtures for the expression-engine suites.
 *
 * Not a `.test.ts` file, so vitest's `src/**\/*.test.ts` include never collects
 * it as a suite and coverage's `src/**\/__tests__/**` exclude still covers it.
 *
 * `scopeOf` is the whole contract the interpreter has with the runtime: a
 * `getters` record and a `setters` record, both null-prototype. Building it in
 * one place keeps the semantics suite, the attack suite and the handler suite
 * testing the same shape of scope rather than three slightly different ones.
 */
import { compileExpression, evaluateExpression } from '../index';
import type { ScopeLike } from '../interp';

export interface TestScope extends ScopeLike {
  /** The live state object behind the getters, for asserting on writes. */
  state: Record<string, unknown>;
}

/** A scope whose every key is a readable and writable state cell. */
export function scopeOf(state: Record<string, unknown>): TestScope {
  const box = { ...state };
  const getters: Record<string, () => unknown> = Object.create(null);
  const setters: Record<string, (v: unknown) => void> = Object.create(null);
  for (const k of Object.keys(box)) {
    getters[k] = () => box[k];
    setters[k] = (v) => { box[k] = v; };
  }
  return { getters, setters, state: box };
}

/** Compile and evaluate `src` against a fresh scope built from `state`. */
export function run(src: string, state: Record<string, unknown> = {}): unknown {
  return evaluateExpression(compileExpression(src), scopeOf(state));
}
