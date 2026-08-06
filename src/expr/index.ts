/**
 * The CSP-safe expression engine: lexer → Pratt parser → validator →
 * tree-walking interpreter, behind a two-call API.
 *
 * It is the ONLY expression engine in every build. There is no regex fast path
 * in front of it (two grammars that must agree forever is a permanent bug farm,
 * and it measured +6.1 KB instead of +1.7 KB) and no `new Function` fallback
 * behind it (its presence is what made the `with()`-proxy hole reachable, and
 * what made "CSP-safe" false for the standard build).
 *
 * Compilation is scope-independent, so a compiled program is cached once by
 * source text and reused across every element and every list row that carries
 * the same expression. Compilation FAILURES are cached the same way: a rejected
 * expression is parsed once, not once per row.
 *
 * Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
 */
import type { Expr, Stmt } from './ast';
import { isExprError, type FormaExprError } from './errors';
import { parseExpression, parseProgram } from './parser';
import { validateExpression, validateProgram } from './validate';
import { evalExpr, makeCtx, runProgram, type ScopeLike } from './interp';

export { LIMITS } from './ast';
export { isExprError, type FormaExprError, type ExprErrorCode } from './errors';
export { hostFn, hostObject, isHost, type Host } from './host';
export { allowlistSnapshot, SAFE_GLOBALS } from './allowlist';
export { safeKey, safeRead, setStepBudget, getStepBudget, type ScopeLike } from './interp';

const CACHE_MAX = 2048;

type CacheEntry<T> = { ok: true; value: T } | { ok: false; error: FormaExprError };

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | undefined {
  return cache.get(key);
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

const exprCache = new Map<string, CacheEntry<Expr>>();
const programCache = new Map<string, CacheEntry<Stmt[]>>();

/** Drop every cached program. Used by `destroyRuntime()` and by tests. */
export function clearExpressionCache(): void {
  exprCache.clear();
  programCache.clear();
}

/**
 * Parse + validate a value expression. Throws a `FormaExprError` the caller is
 * expected to report — there is no "returns null and the caller guesses" path.
 * Verified by: src/expr/__tests__/interp.test.ts > "a rejected expression throws the same error every time it is compiled"
 */
export function compileExpression(source: string): Expr {
  const hit = cacheGet(exprCache, source);
  if (hit) {
    if (hit.ok) return hit.value;
    throw hit.error;
  }
  try {
    const node = parseExpression(source);
    validateExpression(node);
    cacheSet(exprCache, source, { ok: true, value: node });
    return node;
  } catch (err) {
    if (isExprError(err)) cacheSet(exprCache, source, { ok: false, error: err });
    throw err;
  }
}

/** Parse + validate a `data-on:*` handler body. */
export function compileHandler(source: string): Stmt[] {
  const hit = cacheGet(programCache, source);
  if (hit) {
    if (hit.ok) return hit.value;
    throw hit.error;
  }
  try {
    const stmts = parseProgram(source);
    validateProgram(stmts);
    cacheSet(programCache, source, { ok: true, value: stmts });
    return stmts;
  } catch (err) {
    if (isExprError(err)) cacheSet(programCache, source, { ok: false, error: err });
    throw err;
  }
}

/** Evaluate a compiled expression against a scope. */
export function evaluateExpression(node: Expr, scope: ScopeLike): unknown {
  return evalExpr(node, makeCtx(scope));
}

/** Run a compiled handler against a scope. */
export function runHandler(stmts: Stmt[], scope: ScopeLike): void {
  runProgram(stmts, makeCtx(scope));
}
