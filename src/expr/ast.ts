/**
 * The AST is a CLOSED discriminated union (guarantee G3).
 *
 * `validate.ts` and `interp.ts` both end their switch with
 * `const _never: never = node`, so adding a node kind without adding a
 * validator case AND an interpreter case is a compile error, not a runtime
 * surprise. That is the mechanical reason this grammar cannot quietly grow into
 * a mini-eval.
 * Verified by: src/expr/__tests__/validate.test.ts > "every AST kind has a validator case and an interpreter case"
 */

export type Expr =
  | { k: 'Literal'; value: string | number | boolean | null | undefined; i: number }
  | { k: 'Identifier'; name: string; i: number }
  | { k: 'Template'; quasis: string[]; exprs: Expr[]; i: number }
  | { k: 'ArrayLit'; elements: Expr[]; i: number }
  | { k: 'ObjectLit'; keys: string[]; values: Expr[]; i: number }
  | { k: 'Unary'; op: UnaryOp; arg: Expr; i: number }
  | { k: 'Binary'; op: BinaryOp; left: Expr; right: Expr; i: number }
  | { k: 'Logical'; op: LogicalOp; left: Expr; right: Expr; paren?: true; i: number }
  | { k: 'Conditional'; test: Expr; then: Expr; else: Expr; i: number }
  | { k: 'Member'; object: Expr; key: string; optional: boolean; i: number }
  | { k: 'Computed'; object: Expr; key: Expr; optional: boolean; i: number }
  | { k: 'Call'; callee: Expr; args: Expr[]; optional: boolean; i: number }
  | { k: 'Arrow'; params: string[]; body: Expr; i: number };

export type UnaryOp = '!' | '-' | '+' | 'typeof';
export type BinaryOp = '===' | '!==' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '+' | '-' | '*' | '/' | '%';
export type LogicalOp = '&&' | '||' | '??';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

/** The three expression shapes a handler may write to. */
export type AssignTarget = Extract<Expr, { k: 'Identifier' | 'Member' | 'Computed' }>;

/** Statement forms, valid only in `data-on:*` handlers. */
export type Stmt =
  | { k: 'ExprStmt'; expr: Expr; i: number }
  | { k: 'Assign'; target: AssignTarget; op: AssignOp; value: Expr; i: number }
  | { k: 'Update'; target: AssignTarget; op: '++' | '--'; prefix: boolean; i: number }
  | { k: 'If'; test: Expr; then: Stmt[]; else: Stmt[] | null; i: number };

/**
 * Budgets. Parse-time limits bound the SHAPE of the program; evaluation-time
 * limits bound its COST. Neither bounds termination — with no loops and no
 * recursion the language is total by construction, so nothing here is load
 * bearing for "does it stop".
 */
export const LIMITS = Object.freeze({
  MAX_SOURCE_LENGTH: 4096,
  MAX_AST_NODES: 512,
  MAX_AST_DEPTH: 32,
  MAX_ARROW_DEPTH: 2,
  MAX_CALL_ARGS: 4,
  MAX_ARROW_PARAMS: 3,
  MAX_OBJECT_KEYS: 24,
  MAX_ARRAY_ELEMENTS: 64,
  STEP_BUDGET: 100_000,
  MAX_ARRAY_LENGTH: 1_000_000,
  MAX_STRING_LENGTH: 1_048_576,
  MAX_REPEAT_COUNT: 10_000,
  MAX_FLAT_DEPTH: 8,
});
