/**
 * Errors raised by the allowlist expression engine.
 *
 * Every failure mode has a stable code, because the whole point of this engine
 * is that an expression it cannot evaluate says so. `undefined` is a legitimate
 * VALUE here (an absent object key, a nullish base), so it can never double as
 * an error signal — see R1 in docs/design/CSP-GRAMMAR.md.
 *
 * These are plain branded `Error` objects rather than a class hierarchy: a
 * `class` body would put the identifier `constructor` into src/expr/, which the
 * escape-hatch gate rejects on sight so that the *real* thing it is looking for
 * (`x.constructor`) cannot hide behind a false positive.
 * Verified by: src/expr/__tests__/no-escape-hatch.test.ts > "src/expr contains no path to the Function constructor or a global"
 */

export type ExprErrorCode =
  /** The lexer or parser refused the source text. */
  | 'FORMA_E_SYNTAX'
  /** Syntactically fine, semantically outside the grammar (e.g. a stray arrow). */
  | 'FORMA_E_UNSUPPORTED'
  /** A parse-time budget (length, node count, depth, arity) was exceeded. */
  | 'FORMA_E_LIMIT'
  /** An identifier resolved to nothing — never a global, never `undefined`. */
  | 'FORMA_E_UNRESOLVED'
  /** A property key was rejected by `safeKey` (deny-listed, symbol, oversized). */
  | 'FORMA_E_KEY_DENIED'
  /** A property read was refused for this receiver kind. */
  | 'FORMA_E_PROPERTY_DENIED'
  /** No allowlisted method of that name exists for this receiver kind. */
  | 'FORMA_E_METHOD_DENIED'
  /** The call target is not an allowlisted callable. */
  | 'FORMA_E_CALL_DENIED'
  /** The assignment target is unknown or not writable. */
  | 'FORMA_E_ASSIGN_DENIED'
  /** An evaluation-time budget (steps, array/string size) was exceeded. */
  | 'FORMA_E_BUDGET';

const EXPR_ERROR = Symbol.for('forma.expr.error');

export interface FormaExprError extends Error {
  code: ExprErrorCode;
  /** 0-based column in the expression source, or -1 when not positional. */
  column: number;
}

/** Build a reportable expression error. */
export function exprError(
  code: ExprErrorCode,
  message: string,
  column = -1,
): FormaExprError {
  const err = new Error(message) as FormaExprError;
  err.name = 'FormaExpressionError';
  err.code = code;
  err.column = column;
  (err as unknown as Record<symbol, unknown>)[EXPR_ERROR] = true;
  return err;
}

/**
 * True for errors this engine raised deliberately. The binding boundary in
 * runtime.ts reports these and leaves the DOM untouched; anything else is a bug
 * in FormaJS and is rethrown rather than swallowed.
 * Verified by: src/__tests__/failure-semantics.test.ts > "a genuine runtime bug is not swallowed as an expression denial"
 */
export function isExprError(e: unknown): e is FormaExprError {
  return (
    typeof e === 'object'
    && e !== null
    && (e as Record<symbol, unknown>)[EXPR_ERROR] === true
  );
}
