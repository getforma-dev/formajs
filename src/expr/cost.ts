/**
 * THE COST TABLE (DR-16). What each allowlisted native may cost, read from its
 * receiver and arguments BEFORE it runs, and charged to one allocation budget
 * per evaluation (`LIMITS.ALLOC_BUDGET`).
 *
 * The step budget counts interpreter nodes, not the work inside a native, so a
 * single `Array.from({length: 12000000})` used to build a 139 MB array in a
 * 300 ms task before its result was refused. A cost here is computed without
 * running the native, so the refusal comes first.
 *
 * Units: one per array slot or string character a call produces or converts,
 * one-sixteenth per element it only scans or shares. Every call is charged, in
 * order: the text weight of each argument (most natives convert an argument to
 * a string or a number, and an array becomes text through `join`), unless the
 * native is in `DATA_ARGS`; then its row below, if it has one. A native with no
 * row costs only the text of its arguments.
 *
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every allowlisted native refuses an argument heavier than the budget before it runs"
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every size-driven cost refuses a hostile size before the native runs"
 */

// Captured once, like the allowlist's intrinsics, so a page script that later
// replaces Object.values cannot make a cost read low.
const isArray = Array.isArray;
const keysOf = Object.keys;
const valuesOf = Object.values;
const log2 = Math.log2;
const NONE: unknown[] = [];

type Cost = (recv: unknown, args: unknown[], room: number) => number;

/** Elements in a string or array; 0 for anything else. */
const len = (v: unknown): number => (typeof v === 'string' || isArray(v) ? v.length : 0);

/** A count argument as the native reads it, never negative. */
const count = (v: unknown): number => Math.max(0, Number(v) || 0);

/**
 * Weigh a value without converting it, stopping once the total passes `room`.
 *
 * With `depth` < 0 (the default) this is its weight as text: a string counts
 * its characters, an array its length plus its elements, an object one plus
 * the key length per own member plus its values, a number 3 (converting a
 * double to text measured about three array slots), anything else 1.
 * An array holding the same long string a thousand times therefore weighs a
 * thousand strings, which is what `String()` or `join` would build from it.
 *
 * With `depth` >= 0 it counts the slots `flat(depth - 1)` visits: each array
 * expanded adds its length, and only arrays it will expand are queued.
 *
 * Iterative, and every expansion adds to the total before its children are
 * queued, so a cyclic or ten-thousand-deep value stops at `room` instead of
 * looping or overflowing the stack.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "weighing stops at the budget on a cyclic or deeply nested value"
 */
export function weigh(root: unknown, room: number, depth = -1): number {
  let total = 0;
  const todo: unknown[] = [root];
  const depths: number[] = [depth];
  while (todo.length > 0 && total <= room) {
    const v = todo.pop();
    const d = depths.pop()!;
    let kids = NONE;
    if (isArray(v)) {
      if (d) {
        total += v.length;
        kids = v;
      }
    } else if (d >= 0) {
      // Counting slots: a leaf was counted as its parent's slot.
    } else if (typeof v === 'string') {
      total += v.length;
    } else if (typeof v === 'object' && v) {
      for (const k of keysOf(v)) total += k.length + 1;
      kids = valuesOf(v);
    } else {
      total += typeof v === 'number' ? 3 : 1;
    }
    if (total <= room) {
      for (const k of kids) {
        if (d < 0 || (d > 1 && isArray(k))) {
          todo.push(k);
          depths.push(d - 1);
        }
      }
    }
  }
  return total;
}

/**
 * What one replacement adds to the receiver's length, at most. A `$` pattern in
 * the replacement can insert the match or the text before or after it, so each
 * of its characters may stand for the whole receiver.
 */
const grow = (r: unknown, args: unknown[]): number => {
  const by = String(args[1]);
  return Math.max(0, by.length * (by.includes('$') ? len(r) + 1 : 1) - String(args[0]).length);
};

/**
 * Natives that read their arguments as values, never as text, so a large
 * argument costs them nothing: the predicates `items.filter(Boolean)` and its
 * kin apply to every element.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a predicate native reads a large argument for free"
 */
export const DATA_ARGS: ReadonlySet<string> = new Set([
  'Array.isArray', 'Boolean', 'Number.isFinite', 'Number.isInteger', 'Number.isNaN',
]);

/**
 * One row per native whose cost grows with its receiver or with a size or
 * count argument. Keys are `array.<method>`, `string.<method>`, or the label
 * a global carries (`Array.from`).
 *
 * - `array.sort` charges n log n comparisons. The default order converts both
 *   elements to text at every comparison, so an element that is an array adds
 *   its text weight each time.
 * - `Array.from` reads an array-like's `length`; the argument was already
 *   charged as text, so converting that `length` here is bounded.
 * - `Object.keys` / `values` / `entries` charge 8 per element: listing a
 *   string's index keys measured several array slots per key.
 */
export const COSTS: Readonly<Record<string, Cost>> = Object.create(null) as Record<string, Cost>;

function rows(cost: Cost, names: string): void {
  for (const name of names.split(' ')) (COSTS as Record<string, Cost>)[name] = cost;
}

// The result is a copy of the receiver, or no longer than it.
rows(
  (r) => len(r),
  'array.concat array.filter array.flatMap array.map array.reverse array.slice ' +
    'string.concat string.toLowerCase string.toUpperCase',
);
// The receiver is scanned or shared, not copied: a sixteenth per element.
rows(
  (r) => len(r) / 16,
  'array.includes array.indexOf array.lastIndexOf string.endsWith string.includes string.indexOf ' +
    'string.lastIndexOf string.slice string.startsWith string.substring string.trim string.trimEnd string.trimStart',
);
rows((r, a) => Math.max(len(r), count(a[0])), 'string.padEnd string.padStart');
rows((_, a) => 8 * len(a[0]), 'Object.entries Object.keys Object.values');
rows((r, a, room) => weigh(r, room, (a[0] === undefined ? 1 : count(a[0])) + 1), 'array.flat');
rows((r, a, room) => weigh(r, room) + len(r) * (a[0] === undefined ? 1 : String(a[0]).length), 'array.join');
rows((r, a, room) => {
  let per = 3 * len(r);
  if (a[0] === undefined && isArray(r)) {
    for (const e of r) {
      if (per > room) break;
      if (isArray(e)) per += weigh(e, room);
    }
  }
  return per * log2(len(r) + 1);
}, 'array.sort');
rows((r, a) => len(r) * count(a[0]), 'string.repeat');
rows((r, a) => len(r) + grow(r, a), 'string.replace');
rows((r, a) => len(r) + (len(r) + 1) * grow(r, a), 'string.replaceAll');
rows((r) => len(r) + 1, 'string.split');
rows((_, a) => {
  const x = a[0];
  return typeof x === 'object' && x !== null && !isArray(x) ? count((x as { length?: unknown }).length) : len(x);
}, 'Array.from');
Object.freeze(COSTS);
