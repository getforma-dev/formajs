/**
 * The positional arrow rule and the parse-time budgets.
 *
 * The arrow rule is the whole reason arrows are safe to add: a function that
 * cannot be stored, named, returned or re-invoked cannot recurse, cannot be
 * deferred, and cannot be handed to anything but the allowlisted higher-order
 * method whose argument slot it occupies.
 */
import { describe, expect, it } from 'vitest';
import { compileExpression, compileHandler, isExprError, LIMITS } from '../index';
import type { Expr, Stmt } from '../ast';

function err(src: string) {
  try {
    compileExpression(src);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`expected ${src} to be rejected`);
}

function handlerErr(src: string) {
  try {
    compileHandler(src);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`expected handler ${src} to be rejected`);
}

describe('arrow position', () => {
  it('accepts an arrow in the callback slot of every allowlisted method', () => {
    for (const m of ['filter', 'map', 'some', 'every', 'find', 'findIndex', 'flatMap']) {
      expect(() => compileExpression(`items.${m}(i => i > 1)`), m).not.toThrow();
    }
    expect(() => compileExpression('items.reduce((a, b) => a + b, 0)')).not.toThrow();
    expect(() => compileExpression('items.sort((a, b) => a - b)')).not.toThrow();
  });

  it('an arrow outside a callback slot is a validation error', () => {
    const cases = [
      'i => i',                       // the whole expression
      '[i => i]',                     // inside an array literal
      '{ f: i => i }',                // inside an object literal
      'items[i => i]',                // as a computed key
      'items.join(i => i)',           // a non-higher-order method
      'items.filter(x, i => i)',      // a slot that is not the callback slot
      'ok ? i => i : 1',              // a ternary branch
      'items.includes(i => i)',       // an argument that is not a callback
    ];
    for (const src of cases) {
      const e = err(src);
      expect(e.code, src).toBe('FORMA_E_UNSUPPORTED');
      expect(e.message, src).toMatch(/arrow function is only allowed/);
    }
  });

  it('an arrow cannot be assigned or stored by a handler', () => {
    expect(handlerErr('f = i => i').code).toBe('FORMA_E_UNSUPPORTED');
    expect(handlerErr('items = [i => i]').code).toBe('FORMA_E_UNSUPPORTED');
  });

  it('an immediately-invoked arrow is rejected', () => {
    // `(j => j)(i)` would make an arrow a call target, which is the first step
    // towards a function value.
    expect(err('items.filter(i => (j => j)(i))').code).toBe('FORMA_E_UNSUPPORTED');
  });

  it('rejects block bodies, destructuring, defaults and rest', () => {
    expect(err('items.map(i => { return i })').message).toMatch(/block bodies/);
    expect(err('items.map(({ a }) => a)').message).toMatch(/plain identifiers/);
    expect(err('items.map((a = 1) => a)').message).toMatch(/expected "\)"/);
    expect(err('items.map((...a) => a)').message).toMatch(/plain identifiers/);
  });

  it('caps callback parameters at what the method actually passes', () => {
    expect(() => compileExpression('items.map((v, i) => v + i)')).not.toThrow();
    expect(err('items.map((v, i, arr) => v)').message).toMatch(/at most 2 parameter/);
    expect(() => compileExpression('items.reduce((a, v, i) => a + v + i, 0)')).not.toThrow();
  });

  it('caps arrow nesting depth', () => {
    expect(() => compileExpression('a.filter(i => b.map(j => j).length > i)')).not.toThrow();
    expect(err('a.filter(i => b.map(j => c.map(k => k).length).length > i)').code)
      .toBe('FORMA_E_LIMIT');
  });

  it('rejects duplicate parameter names', () => {
    expect(err('items.reduce((a, a) => a, 0)').code).toBe('FORMA_E_SYNTAX');
  });
});

describe('parse-time budgets', () => {
  it('caps source length', () => {
    const long = `'${'x'.repeat(LIMITS.MAX_SOURCE_LENGTH)}'`;
    expect(err(long).code).toBe('FORMA_E_LIMIT');
  });

  it('caps nesting depth', () => {
    const deep = '('.repeat(LIMITS.MAX_AST_DEPTH + 2) + 'a' + ')'.repeat(LIMITS.MAX_AST_DEPTH + 2);
    expect(err(deep).code).toBe('FORMA_E_LIMIT');
  });

  it('caps node count', () => {
    const wide = Array.from({ length: LIMITS.MAX_AST_NODES }, (_, i) => String(i)).join(' + ');
    expect(err(wide).code).toBe('FORMA_E_LIMIT');
  });

  it('caps call arity, array size and object size', () => {
    expect(err('a.join(1, 2, 3, 4, 5)').code).toBe('FORMA_E_LIMIT');
    const many = Array.from({ length: LIMITS.MAX_ARRAY_ELEMENTS + 1 }, () => '1').join(',');
    expect(err(`[${many}]`).code).toBe('FORMA_E_LIMIT');
    const keys = Array.from({ length: LIMITS.MAX_OBJECT_KEYS + 1 }, (_, i) => `k${i}: 1`).join(',');
    expect(err(`{${keys}}`).code).toBe('FORMA_E_LIMIT');
  });
});

describe('handler statement shapes', () => {
  it('a statement must do something', () => {
    // A bare `count` or `a + b` statement is dead code, and far more often a
    // typo for `count++` than intent.
    expect(handlerErr('count').message).toMatch(/must be an assignment/);
    expect(handlerErr('a + b').message).toMatch(/must be an assignment/);
  });

  it('rejects an assignment to something that is not a path', () => {
    expect(handlerErr("'x' = 1").message).toMatch(/must be a name or a property path/);
    expect(handlerErr('a + b = 1').message).toMatch(/must be a name or a property path/);
  });

  it('requires a separator between statements', () => {
    expect(handlerErr('a = 1 b = 2').message).toMatch(/expected ";"/);
  });
});

describe('exhaustiveness', () => {
  it('every AST kind has a validator case and an interpreter case', () => {
    // The union is closed and both passes end with `const never: never = node`,
    // so this list is a compile-time contract as well as a runtime one: adding
    // a kind without both cases does not build. Keeping the roster here means a
    // silently-dropped case is also visible in review.
    const exprKinds: Array<Expr['k']> = [
      'Literal', 'Identifier', 'Template', 'ArrayLit', 'ObjectLit', 'Unary',
      'Binary', 'Logical', 'Conditional', 'Member', 'Computed', 'Call', 'Arrow',
    ];
    const stmtKinds: Array<Stmt['k']> = ['ExprStmt', 'Assign', 'Update', 'If'];
    expect(new Set(exprKinds).size).toBe(13);
    expect(new Set(stmtKinds).size).toBe(4);
  });
});
