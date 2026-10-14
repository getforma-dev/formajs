/**
 * Regression fixture for the native-call cost path (FORMA-001, stage 0).
 *
 * An allowlisted native such as `Array.from` is invoked first and its result's
 * size is checked only after it returns (`callHostMethod` → `checkResultSize`).
 * The step budget counts interpreter nodes, not work inside the native, so
 * `Array.from({length: 12000000})` allocates a twelve-million-element array
 * (about 139 MB and a 300 ms task in Chromium) before `FORMA_E_BUDGET` is
 * reported. Verified in a browser by the Forma Stack audit verification, run 4,
 * and recorded as DR-16 of the v2 decision brief.
 *
 * What this file pins is the guarantee DR-16 asks for: the hostile call is
 * refused BEFORE the native runs, so nothing is allocated. The only way to see
 * "before" from a unit test is to watch the intrinsic the interpreter holds.
 * The allowlist captures `Array.from` when its module is evaluated, so the
 * test wraps `Array.from` (a call-through spy, nothing is faked) and then loads
 * a fresh copy of the expression engine, which captures the wrapper.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const HOSTILE_LENGTH = 12_000_000;
const HOSTILE = `Array.from({length: ${HOSTILE_LENGTH}})`;

/** Load a fresh expression engine whose allowlist captured the current `Array.from`. */
async function freshEngine() {
  vi.resetModules();
  return import('../index');
}

/** The calls the native received with an array-like of the hostile length. */
function hostileCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter(([source]) => {
    const length = (source as { length?: unknown } | null | undefined)?.length;
    return length === HOSTILE_LENGTH;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('native-call cost preflight (DR-16)', () => {
  it('the wrapped intrinsic is the one the interpreter calls (control)', async () => {
    // The "not reached" case below counts calls on the wrapper. If the fresh
    // engine ever captured the real Array.from instead, it would count zero
    // whatever the engine does: on main that turns the it.fails red, but once
    // FORMA-004 removes the marker it would pass vacuously. This control keeps
    // "zero calls" meaning "the native did not run".
    const from = vi.spyOn(Array, 'from');
    const { compileExpression, evaluateExpression } = await freshEngine();
    const scope = { getters: Object.create(null), setters: Object.create(null) };

    const result = evaluateExpression(compileExpression('Array.from({length: 3})'), scope);

    expect(result).toEqual([undefined, undefined, undefined]);
    expect(from.mock.calls.some(([source]) => (source as { length?: unknown })?.length === 3)).toBe(true);
  });

  describe(HOSTILE, () => {
    // Evaluated once for both tests below, so the twelve-million-element array
    // (built on main) is allocated once per run, not twice.
    let outcome: { result: unknown; code: unknown; reached: number };

    beforeAll(async () => {
      const from = vi.spyOn(Array, 'from');
      try {
        const { compileExpression, evaluateExpression, isExprError } = await freshEngine();
        const scope = { getters: Object.create(null), setters: Object.create(null) };
        let result: unknown;
        let code: unknown;
        try {
          result = evaluateExpression(compileExpression(HOSTILE), scope);
        } catch (e) {
          code = isExprError(e) ? (e as { code: string }).code : e;
        }
        outcome = { result, code, reached: hostileCalls(from).length };
      } finally {
        // Drop the recorded results, so the allocated array is not kept alive
        // for the rest of the run.
        from.mockRestore();
      }
    });

    it('is refused with FORMA_E_BUDGET, not answered', () => {
      // Passes on main (checkResultSize refuses after the call) and must keep
      // passing when FORMA-004 moves the refusal before the call.
      expect(outcome.result).toBeUndefined();
      expect(outcome.code).toBe('FORMA_E_BUDGET');
    });

    // Was `it.fails` until FORMA-004 (DR-16: a cost function per allowlisted
    // native, checked before the call). Before it, the native built the array
    // and only then was the result refused.
    it('is refused before the native allocates', () => {
      expect(outcome.reached, 'Array.from was invoked with {length: 12000000} before the refusal').toBe(0);
    });
  });
});
