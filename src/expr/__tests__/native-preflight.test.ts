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
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    // Without this control, the expected-fail case below could "fail" because
    // the spy never reached the allowlist, not because of the defect.
    const from = vi.spyOn(Array, 'from');
    const { compileExpression, evaluateExpression } = await freshEngine();
    const scope = { getters: Object.create(null), setters: Object.create(null) };

    const result = evaluateExpression(compileExpression('Array.from({length: 3})'), scope);

    expect(result).toEqual([undefined, undefined, undefined]);
    expect(from.mock.calls.some(([source]) => (source as { length?: unknown })?.length === 3)).toBe(true);
  });

  // Expected to fail until FORMA-004 (DR-16: a cost function per allowlisted
  // native, checked before the call) lands. When it passes, remove `.fails`.
  // On main the engine does report FORMA_E_BUDGET, but only after the native
  // has built the twelve-million-element array, so the second assertion fails.
  it.fails('Array.from({length: 12000000}) is refused before the native allocates', async () => {
    const from = vi.spyOn(Array, 'from');
    const { compileExpression, evaluateExpression, isExprError } = await freshEngine();
    const scope = { getters: Object.create(null), setters: Object.create(null) };

    let error: unknown;
    let result: unknown;
    try {
      result = evaluateExpression(compileExpression(HOSTILE), scope);
    } catch (e) {
      error = e;
    }
    // Drop the recorded results before asserting, so a failure does not keep
    // the allocated array alive for the rest of the run.
    const reached = hostileCalls(from).length;
    from.mockClear();

    // The refusal is reported with the budget code, not as a silent value.
    expect(result).toBeUndefined();
    expect(isExprError(error) ? (error as { code: string }).code : error).toBe('FORMA_E_BUDGET');
    // And it is made before the native runs: Array.from never saw the
    // hostile array-like, so no twelve-million-element array was built.
    expect(reached, 'Array.from was invoked with {length: 12000000} before the refusal').toBe(0);
  });
});
