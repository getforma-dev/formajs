/**
 * Precedence-climbing (Pratt) parser — guarantee G2: total consumption or a
 * reported error. There is no "no branch matched, return null" path, because
 * that shape is exactly what let a hostile string that NO branch understood
 * fall through to `new Function` in the parser this replaces.
 *
 * It also fixes two precedence bugs that the regex cascade shipped:
 *
 *   `!a || b`  — the cascade tested `expr.startsWith('!')` BEFORE every binary
 *                operator, so unary `!` had the LOWEST precedence and this
 *                computed `!(a || b)`. Silently. With a=1,b=2 it returned
 *                `false` where JavaScript returns `2`.
 *   `a ? 'https://x' : 'y'`
 *              — the ternary regex was string-blind, so the `//` inside a URL
 *                literal killed the match and the whole binding was rejected.
 *
 * Verified by: src/expr/__tests__/parser-precedence.test.ts > "unary ! binds tighter than || (the HEAD bug)"
 * Verified by: src/expr/__tests__/parser-precedence.test.ts > "a ternary branch may contain a string with a colon or a slash"
 */
import { LIMITS, type AssignOp, type AssignTarget, type BinaryOp, type Expr, type LogicalOp, type Stmt, type UnaryOp } from './ast';
import { exprError } from './errors';
import { DENY_KEYS, MAX_KEY_LENGTH } from './allowlist';
import { lex, type Token } from './lexer';

/**
 * Binding powers. `??` sits below `||`, which sits below `&&`, matching
 * JavaScript; mixing `??` with either without parentheses is rejected the way
 * JavaScript rejects it, so no expression can mean something different here.
 */
const BINDING: Readonly<Record<string, number>> = {
  '??': 3,
  '||': 4,
  '&&': 5,
  '===': 8, '!==': 8, '==': 8, '!=': 8,
  '<': 9, '>': 9, '<=': 9, '>=': 9,
  '+': 11, '-': 11,
  '*': 12, '/': 12, '%': 12,
};

const ASSIGN_OPS: ReadonlySet<string> = new Set(['=', '+=', '-=', '*=', '/=']);
const RESERVED: ReadonlySet<string> = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'if', 'else']);

interface PState {
  toks: Token[];
  pos: number;
  nodes: number;
  depth: number;
  arrowDepth: number;
}

function state(toks: Token[]): PState {
  return { toks, pos: 0, nodes: 0, depth: 0, arrowDepth: 0 };
}

function peek(st: PState): Token {
  return st.toks[st.pos]!;
}

function isPunc(tok: Token, v: string): boolean {
  return tok.t === 'punc' && tok.v === v;
}

function expectPunc(st: PState, v: string): Token {
  const tok = peek(st);
  if (!isPunc(tok, v)) {
    throw exprError('FORMA_E_SYNTAX', `expected "${v}" but found ${describe(tok)}`, tok.i);
  }
  st.pos++;
  return tok;
}

function describe(tok: Token): string {
  if (tok.t === 'eof') return 'end of expression';
  if (tok.t === 'str') return 'a string literal';
  if (tok.t === 'tmpl') return 'a template literal';
  return `"${tok.v}"`;
}

/** Count a node against MAX_AST_NODES and hand it back. */
function mk<T extends Expr | Stmt>(st: PState, node: T): T {
  st.nodes++;
  if (st.nodes > LIMITS.MAX_AST_NODES) {
    throw exprError('FORMA_E_LIMIT', `expression has more than ${LIMITS.MAX_AST_NODES} nodes`, node.i);
  }
  return node;
}

/** Reject a deny-listed or oversized static key at PARSE time, for a good error. */
function checkStaticKey(name: string, at: number): string {
  if (DENY_KEYS.has(name)) {
    throw exprError('FORMA_E_KEY_DENIED', `property "${name}" is never accessible`, at);
  }
  if (name.length > MAX_KEY_LENGTH) {
    throw exprError('FORMA_E_KEY_DENIED', 'property name is too long', at);
  }
  return name;
}

// ── Expressions ──

function parseConditional(st: PState): Expr {
  const test = parseBinary(st, 0);
  const tok = peek(st);
  if (isPunc(tok, '?')) {
    st.pos++;
    const then = parseConditional(st);
    expectPunc(st, ':');
    const otherwise = parseConditional(st);
    return mk(st, { k: 'Conditional', test, then, else: otherwise, i: test.i });
  }
  return test;
}

function parseBinary(st: PState, minBp: number): Expr {
  st.depth++;
  if (st.depth > LIMITS.MAX_AST_DEPTH) {
    throw exprError('FORMA_E_LIMIT', `expression nests deeper than ${LIMITS.MAX_AST_DEPTH}`, peek(st).i);
  }
  try {
    let left = parseUnary(st);
    for (;;) {
      const tok = peek(st);
      if (tok.t !== 'punc') break;
      const bp = BINDING[tok.v];
      if (bp === undefined || bp < minBp) break;
      st.pos++;
      const right = parseBinary(st, bp + 1);
      if (tok.v === '&&' || tok.v === '||' || tok.v === '??') {
        rejectNullishMix(tok.v as LogicalOp, left, right, tok.i);
        left = mk(st, { k: 'Logical', op: tok.v as LogicalOp, left, right, i: tok.i });
      } else {
        left = mk(st, { k: 'Binary', op: tok.v as BinaryOp, left, right, i: tok.i });
      }
    }
    return left;
  } finally {
    st.depth--;
  }
}

/** `a ?? b || c` is a SyntaxError in JavaScript; it is one here too. */
function rejectNullishMix(op: LogicalOp, left: Expr, right: Expr, at: number): void {
  for (const side of [left, right]) {
    if (side.k === 'Logical' && side.paren !== true && (side.op === '??') !== (op === '??')) {
      throw exprError(
        'FORMA_E_SYNTAX',
        `"${op}" and "${side.op}" cannot be mixed without parentheses`,
        at,
      );
    }
  }
}

function parseUnary(st: PState): Expr {
  const tok = peek(st);
  if (tok.t === 'punc' && (tok.v === '!' || tok.v === '-' || tok.v === '+')) {
    st.pos++;
    return mk(st, { k: 'Unary', op: tok.v as UnaryOp, arg: parseUnary(st), i: tok.i });
  }
  if (tok.t === 'name' && tok.v === 'typeof') {
    st.pos++;
    return mk(st, { k: 'Unary', op: 'typeof', arg: parseUnary(st), i: tok.i });
  }
  return parsePostfix(st);
}

function parsePostfix(st: PState): Expr {
  let node = parsePrimary(st);
  for (;;) {
    const tok = peek(st);
    if (isPunc(tok, '.')) {
      st.pos++;
      node = mk(st, { k: 'Member', object: node, key: readMemberName(st), optional: false, i: tok.i });
      continue;
    }
    if (isPunc(tok, '?.')) {
      st.pos++;
      const next = peek(st);
      if (isPunc(next, '[')) {
        st.pos++;
        const key = parseConditional(st);
        expectPunc(st, ']');
        node = mk(st, { k: 'Computed', object: node, key, optional: true, i: tok.i });
      } else if (isPunc(next, '(')) {
        node = mk(st, { k: 'Call', callee: node, args: parseArgs(st), optional: true, i: tok.i });
      } else {
        node = mk(st, { k: 'Member', object: node, key: readMemberName(st), optional: true, i: tok.i });
      }
      continue;
    }
    if (isPunc(tok, '[')) {
      st.pos++;
      const key = parseConditional(st);
      expectPunc(st, ']');
      node = mk(st, { k: 'Computed', object: node, key, optional: false, i: tok.i });
      continue;
    }
    if (isPunc(tok, '(')) {
      node = mk(st, { k: 'Call', callee: node, args: parseArgs(st), optional: false, i: tok.i });
      continue;
    }
    break;
  }
  return node;
}

function readMemberName(st: PState): string {
  const tok = peek(st);
  if (tok.t !== 'name') {
    throw exprError('FORMA_E_SYNTAX', `expected a property name but found ${describe(tok)}`, tok.i);
  }
  st.pos++;
  return checkStaticKey(tok.v, tok.i);
}

function parseArgs(st: PState): Expr[] {
  const open = expectPunc(st, '(');
  const args: Expr[] = [];
  if (!isPunc(peek(st), ')')) {
    for (;;) {
      args.push(parseConditional(st));
      if (isPunc(peek(st), ',')) { st.pos++; continue; }
      break;
    }
  }
  expectPunc(st, ')');
  if (args.length > LIMITS.MAX_CALL_ARGS) {
    throw exprError('FORMA_E_LIMIT', `a call takes at most ${LIMITS.MAX_CALL_ARGS} arguments`, open.i);
  }
  return args;
}

/** True when the `(` at the cursor opens an arrow-function parameter list. */
function isArrowAhead(st: PState): boolean {
  let depth = 0;
  for (let i = st.pos; i < st.toks.length; i++) {
    const tok = st.toks[i]!;
    if (tok.t !== 'punc') continue;
    if (tok.v === '(') depth++;
    else if (tok.v === ')') {
      depth--;
      if (depth === 0) return isPunc(st.toks[i + 1] ?? { t: 'eof', v: '', i: 0 }, '=>');
    }
  }
  return false;
}

function parseArrow(st: PState, params: string[], at: number): Expr {
  expectPunc(st, '=>');
  const bodyTok = peek(st);
  if (isPunc(bodyTok, '{')) {
    throw exprError(
      'FORMA_E_UNSUPPORTED',
      'an arrow function body must be a single expression — block bodies are not supported',
      bodyTok.i,
    );
  }
  if (params.length > LIMITS.MAX_ARROW_PARAMS) {
    throw exprError('FORMA_E_LIMIT', `an arrow function takes at most ${LIMITS.MAX_ARROW_PARAMS} parameters`, at);
  }
  st.arrowDepth++;
  if (st.arrowDepth > LIMITS.MAX_ARROW_DEPTH) {
    throw exprError('FORMA_E_LIMIT', `arrow functions nest at most ${LIMITS.MAX_ARROW_DEPTH} deep`, at);
  }
  try {
    const body = parseConditional(st);
    return mk(st, { k: 'Arrow', params, body, i: at });
  } finally {
    st.arrowDepth--;
  }
}

function parsePrimary(st: PState): Expr {
  const tok = peek(st);

  if (tok.t === 'num') {
    st.pos++;
    return mk(st, { k: 'Literal', value: tok.n!, i: tok.i });
  }
  if (tok.t === 'str') {
    st.pos++;
    return mk(st, { k: 'Literal', value: tok.v, i: tok.i });
  }
  if (tok.t === 'tmpl') {
    st.pos++;
    const exprs = (tok.exprs ?? []).map((src, n) => parseSub(st, src, tok.exprAt![n]!));
    return mk(st, { k: 'Template', quasis: tok.quasis!, exprs, i: tok.i });
  }
  if (tok.t === 'name') {
    if (tok.v === 'true' || tok.v === 'false') {
      st.pos++;
      return mk(st, { k: 'Literal', value: tok.v === 'true', i: tok.i });
    }
    if (tok.v === 'null') { st.pos++; return mk(st, { k: 'Literal', value: null, i: tok.i }); }
    if (tok.v === 'undefined') { st.pos++; return mk(st, { k: 'Literal', value: undefined, i: tok.i }); }
    if (RESERVED.has(tok.v)) {
      throw exprError('FORMA_E_SYNTAX', `"${tok.v}" cannot be used here`, tok.i);
    }
    st.pos++;
    if (isPunc(peek(st), '=>')) return parseArrow(st, [tok.v], tok.i);
    return mk(st, { k: 'Identifier', name: tok.v, i: tok.i });
  }

  if (isPunc(tok, '(')) {
    if (isArrowAhead(st)) {
      st.pos++;
      const params: string[] = [];
      if (!isPunc(peek(st), ')')) {
        for (;;) {
          const p = peek(st);
          if (p.t !== 'name' || RESERVED.has(p.v)) {
            throw exprError(
              'FORMA_E_UNSUPPORTED',
              'arrow parameters must be plain identifiers — no destructuring, defaults or rest',
              p.i,
            );
          }
          st.pos++;
          params.push(p.v);
          if (isPunc(peek(st), ',')) { st.pos++; continue; }
          break;
        }
      }
      expectPunc(st, ')');
      return parseArrow(st, params, tok.i);
    }
    st.pos++;
    const inner = parseConditional(st);
    expectPunc(st, ')');
    if (inner.k === 'Logical') inner.paren = true;
    return inner;
  }

  if (isPunc(tok, '[')) {
    st.pos++;
    const elements: Expr[] = [];
    if (!isPunc(peek(st), ']')) {
      for (;;) {
        elements.push(parseConditional(st));
        if (isPunc(peek(st), ',')) {
          st.pos++;
          if (isPunc(peek(st), ']')) break; // trailing comma
          continue;
        }
        break;
      }
    }
    expectPunc(st, ']');
    if (elements.length > LIMITS.MAX_ARRAY_ELEMENTS) {
      throw exprError('FORMA_E_LIMIT', `an array literal holds at most ${LIMITS.MAX_ARRAY_ELEMENTS} elements`, tok.i);
    }
    return mk(st, { k: 'ArrayLit', elements, i: tok.i });
  }

  if (isPunc(tok, '{')) {
    st.pos++;
    const keys: string[] = [];
    const values: Expr[] = [];
    if (!isPunc(peek(st), '}')) {
      for (;;) {
        const keyTok = peek(st);
        let key: string;
        if (keyTok.t === 'name') key = checkStaticKey(keyTok.v, keyTok.i);
        else if (keyTok.t === 'str') key = checkStaticKey(keyTok.v, keyTok.i);
        else {
          throw exprError(
            'FORMA_E_UNSUPPORTED',
            'object keys must be identifiers or string literals — computed keys and spread are not supported',
            keyTok.i,
          );
        }
        st.pos++;
        if (isPunc(peek(st), ':')) {
          st.pos++;
          values.push(parseConditional(st));
        } else if (keyTok.t === 'name') {
          values.push(mk(st, { k: 'Identifier', name: key, i: keyTok.i }));
        } else {
          throw exprError('FORMA_E_SYNTAX', 'expected ":" after a string object key', keyTok.i);
        }
        keys.push(key);
        if (isPunc(peek(st), ',')) {
          st.pos++;
          if (isPunc(peek(st), '}')) break; // trailing comma
          continue;
        }
        break;
      }
    }
    expectPunc(st, '}');
    if (keys.length > LIMITS.MAX_OBJECT_KEYS) {
      throw exprError('FORMA_E_LIMIT', `an object literal holds at most ${LIMITS.MAX_OBJECT_KEYS} keys`, tok.i);
    }
    return mk(st, { k: 'ObjectLit', keys, values, i: tok.i });
  }

  throw exprError('FORMA_E_SYNTAX', `unexpected ${describe(tok)}`, tok.i);
}

/** Parse a `${…}` interpolation, sharing the parent's node and depth budgets. */
function parseSub(st: PState, src: string, at: number): Expr {
  const sub: PState = {
    toks: lex(src, at),
    pos: 0,
    nodes: st.nodes,
    depth: st.depth,
    arrowDepth: st.arrowDepth,
  };
  const expr = parseConditional(sub);
  const trailing = peek(sub);
  if (trailing.t !== 'eof') {
    throw exprError('FORMA_E_SYNTAX', `unexpected ${describe(trailing)} in \${…}`, trailing.i);
  }
  st.nodes = sub.nodes;
  return expr;
}

// ── Statements (data-on:* handlers only) ──

function assertTarget(node: Expr, at: number): AssignTarget {
  if (node.k === 'Identifier' || node.k === 'Member' || node.k === 'Computed') return node;
  throw exprError('FORMA_E_UNSUPPORTED', 'assignment target must be a name or a property path', at);
}

function parseStmt(st: PState): Stmt {
  const tok = peek(st);

  if (tok.t === 'name' && tok.v === 'if') {
    st.pos++;
    expectPunc(st, '(');
    const test = parseConditional(st);
    expectPunc(st, ')');
    const then = parseBlockOrStmt(st);
    let otherwise: Stmt[] | null = null;
    // `if (x) a = 1; else a = 2` — the separator before `else` belongs to the
    // then-branch, so it is consumed here and put back when no `else` follows.
    const mark = st.pos;
    while (isPunc(peek(st), ';')) st.pos++;
    const next = peek(st);
    if (next.t === 'name' && next.v === 'else') {
      st.pos++;
      otherwise = parseBlockOrStmt(st);
    } else {
      st.pos = mark;
    }
    return mk(st, { k: 'If', test, then, else: otherwise, i: tok.i });
  }

  if (isPunc(tok, '++') || isPunc(tok, '--')) {
    st.pos++;
    const target = assertTarget(parsePostfix(st), tok.i);
    return mk(st, { k: 'Update', target, op: tok.v as '++' | '--', prefix: true, i: tok.i });
  }

  const expr = parseConditional(st);
  const after = peek(st);
  if (isPunc(after, '++') || isPunc(after, '--')) {
    st.pos++;
    return mk(st, {
      k: 'Update',
      target: assertTarget(expr, after.i),
      op: after.v as '++' | '--',
      prefix: false,
      i: expr.i,
    });
  }
  if (after.t === 'punc' && ASSIGN_OPS.has(after.v)) {
    st.pos++;
    const value = parseConditional(st);
    return mk(st, {
      k: 'Assign',
      target: assertTarget(expr, after.i),
      op: after.v as AssignOp,
      value,
      i: expr.i,
    });
  }
  return mk(st, { k: 'ExprStmt', expr, i: expr.i });
}

function parseBlockOrStmt(st: PState): Stmt[] {
  if (isPunc(peek(st), '{')) {
    st.pos++;
    const out: Stmt[] = [];
    while (isPunc(peek(st), ';')) st.pos++;
    while (!isPunc(peek(st), '}')) {
      if (peek(st).t === 'eof') {
        throw exprError('FORMA_E_SYNTAX', 'unterminated block', peek(st).i);
      }
      const stmt = parseStmt(st);
      out.push(stmt);
      let sawSeparator = false;
      while (isPunc(peek(st), ';')) { st.pos++; sawSeparator = true; }
      // A block-bodied `if` ends in `}`, which is its own separator.
      if (!sawSeparator && stmt.k !== 'If' && !isPunc(peek(st), '}')) {
        throw exprError('FORMA_E_SYNTAX', `expected ";" between statements, found ${describe(peek(st))}`, peek(st).i);
      }
    }
    st.pos++;
    return out;
  }
  return [parseStmt(st)];
}

// ── Entry points ──

function checkLength(source: string): void {
  if (source.length > LIMITS.MAX_SOURCE_LENGTH) {
    throw exprError(
      'FORMA_E_LIMIT',
      `expression is longer than ${LIMITS.MAX_SOURCE_LENGTH} characters`,
      0,
    );
  }
}

/**
 * Parse a value expression. Trailing tokens are an error — the parser must end
 * at EOF or the input was not understood.
 * Verified by: src/expr/__tests__/parser-precedence.test.ts > "leftover tokens are an error, never a silent partial parse"
 */
export function parseExpression(source: string): Expr {
  checkLength(source);
  const st = state(lex(source));
  if (peek(st).t === 'eof') {
    throw exprError('FORMA_E_SYNTAX', 'empty expression', 0);
  }
  const expr = parseConditional(st);
  const trailing = peek(st);
  if (trailing.t !== 'eof') {
    throw exprError('FORMA_E_SYNTAX', `unexpected ${describe(trailing)}`, trailing.i);
  }
  return expr;
}

/** Parse a `data-on:*` handler body: `;`-separated statements. */
export function parseProgram(source: string): Stmt[] {
  checkLength(source);
  const st = state(lex(source));
  const out: Stmt[] = [];
  while (isPunc(peek(st), ';')) st.pos++;
  while (peek(st).t !== 'eof') {
    const stmt = parseStmt(st);
    out.push(stmt);
    let sawSeparator = false;
    while (isPunc(peek(st), ';')) { st.pos++; sawSeparator = true; }
    // A block-bodied `if` ends in `}`, which is its own separator.
    if (!sawSeparator && stmt.k !== 'If' && peek(st).t !== 'eof') {
      throw exprError('FORMA_E_SYNTAX', `expected ";" between statements, found ${describe(peek(st))}`, peek(st).i);
    }
  }
  if (out.length === 0) {
    throw exprError('FORMA_E_SYNTAX', 'empty handler', 0);
  }
  return out;
}
