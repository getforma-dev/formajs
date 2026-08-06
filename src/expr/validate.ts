/**
 * The validator — guarantee G4: a pass that is NOT the interpreter.
 *
 * It asserts the shape rules the parser is deliberately permissive about, above
 * all the positional rule that keeps arrow functions from becoming values:
 * an `Arrow` node is legal ONLY as argument 0 of a call whose callee is a
 * member access naming an allowlisted higher-order array method. Everywhere
 * else — assigned, stored in an array or object literal, used as a computed
 * key, returned as the value of an expression, invoked immediately — it is a
 * validation error. With no way to name, store or re-invoke a function, there
 * is no recursion and no deferred invocation, which is why the language stays
 * total.
 *
 * The interpreter does NOT trust this pass: it re-asserts every
 * safety-critical invariant (key filter, receiver kind, call target) at
 * evaluation time. This pass exists to give authors an error at bind time
 * instead of a denial at click time.
 * Verified by: src/expr/__tests__/validate.test.ts > "an arrow outside a callback slot is a validation error"
 */
import { LIMITS, type Expr, type Stmt } from './ast';
import { exprError } from './errors';
import { HOF_CALLBACK_PARAMS } from './allowlist';

function tooDeep(at: number): never {
  throw exprError('FORMA_E_LIMIT', `expression nests deeper than ${LIMITS.MAX_AST_DEPTH}`, at);
}

/** Max arrow params permitted at this position, or null when arrows are illegal. */
type ArrowSlot = number | null;

function walk(node: Expr, depth: number, slot: ArrowSlot): void {
  if (depth > LIMITS.MAX_AST_DEPTH) tooDeep(node.i);
  const d = depth + 1;

  switch (node.k) {
    case 'Literal':
    case 'Identifier':
      return;

    case 'Template':
      for (const e of node.exprs) walk(e, d, null);
      return;

    case 'ArrayLit':
      for (const e of node.elements) walk(e, d, null);
      return;

    case 'ObjectLit':
      for (const e of node.values) walk(e, d, null);
      return;

    case 'Unary':
      walk(node.arg, d, null);
      return;

    case 'Binary':
    case 'Logical':
      walk(node.left, d, null);
      walk(node.right, d, null);
      return;

    case 'Conditional':
      walk(node.test, d, null);
      walk(node.then, d, null);
      walk(node.else, d, null);
      return;

    case 'Member':
      walk(node.object, d, null);
      return;

    case 'Computed':
      walk(node.object, d, null);
      walk(node.key, d, null);
      return;

    case 'Call': {
      walk(node.callee, d, null);
      const method = node.callee.k === 'Member' ? node.callee.key : '';
      const callbackParams = Object.hasOwn(HOF_CALLBACK_PARAMS, method)
        ? HOF_CALLBACK_PARAMS[method]!
        : null;
      node.args.forEach((arg, index) => {
        walk(arg, d, index === 0 ? callbackParams : null);
      });
      return;
    }

    case 'Arrow': {
      if (slot === null) {
        throw exprError(
          'FORMA_E_UNSUPPORTED',
          'an arrow function is only allowed as the first argument of '
          + `${Object.keys(HOF_CALLBACK_PARAMS).sort().join('/')} — it cannot be stored, assigned or returned`,
          node.i,
        );
      }
      if (node.params.length > slot) {
        throw exprError(
          'FORMA_E_UNSUPPORTED',
          `this callback receives at most ${slot} parameter(s)`,
          node.i,
        );
      }
      const seen = new Set(node.params);
      if (seen.size !== node.params.length) {
        throw exprError('FORMA_E_SYNTAX', 'duplicate arrow parameter name', node.i);
      }
      walk(node.body, d, null);
      return;
    }

    default: {
      // Exhaustiveness: a new AST kind without a case here is a compile error.
      const never: never = node;
      throw exprError('FORMA_E_UNSUPPORTED', `unhandled node ${JSON.stringify(never)}`, 0);
    }
  }
}

function walkStmt(stmt: Stmt, depth: number): void {
  if (depth > LIMITS.MAX_AST_DEPTH) tooDeep(stmt.i);
  const d = depth + 1;

  switch (stmt.k) {
    case 'ExprStmt':
      // A statement evaluated only for effect has to BE an effect. A bare
      // `count` or `a + b` statement does nothing and is far more likely to be
      // a typo for `count++` than intent.
      if (stmt.expr.k !== 'Call') {
        throw exprError(
          'FORMA_E_UNSUPPORTED',
          'a handler statement must be an assignment, an update, an `if`, or a method call',
          stmt.i,
        );
      }
      walk(stmt.expr, d, null);
      return;

    case 'Assign':
      walk(stmt.target, d, null);
      walk(stmt.value, d, null);
      return;

    case 'Update':
      walk(stmt.target, d, null);
      return;

    case 'If':
      walk(stmt.test, d, null);
      for (const s of stmt.then) walkStmt(s, d);
      for (const s of stmt.else ?? []) walkStmt(s, d);
      return;

    default: {
      const never: never = stmt;
      throw exprError('FORMA_E_UNSUPPORTED', `unhandled statement ${JSON.stringify(never)}`, 0);
    }
  }
}

export function validateExpression(node: Expr): void {
  walk(node, 0, null);
}

export function validateProgram(stmts: Stmt[]): void {
  for (const stmt of stmts) walkStmt(stmt, 0);
}
