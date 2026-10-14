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
// replaces one of them cannot make a cost read low.
const isArray = Array.isArray;
const keysOf = Object.keys;
const valuesOf = Object.values;
const log2 = Math.log2;
const max = Math.max;
const min = Math.min;
const toNumber = Number;
const toText = String;
const NONE: unknown[] = [];

/**
 * Whether the text holds a character whose case mapping costs more than
 * Latin-1's: outside Latin-1 and outside the general punctuation, currency
 * signs and letterlike symbols that map to themselves (U+2000 to U+20CF,
 * U+2100 to U+2125: curly quotes, dashes, `…`, `€`, `™`). Or a character
 * outside ASCII. Bound once, so neither a later page script nor a per-call
 * argument list is involved.
 */
const costly = RegExp.prototype.exec.bind(/[^\x00-\xff\u2000-\u20cf\u2100-\u2125]/);
const nonAscii = RegExp.prototype.exec.bind(/[^\x00-\x7f]/);

type Cost = (recv: unknown, args: unknown[], room: number) => number;

/** Elements in a string or array; 0 for anything else. */
const len = (v: unknown): number => (typeof v === 'string' || isArray(v) ? v.length : 0);

/** A count argument as the native reads it, never negative. */
const count = (v: unknown): number => max(0, toNumber(v) || 0);

/**
 * An argument read as data, not text: a string's or array's length, an
 * object's enumerable keys, or 1. `for...in` has the engine list the keys
 * before the first iteration, so this saves the counting past `room`, not the
 * listing; the object already exists, so the listing is bounded by its size.
 */
const size = (v: unknown, room: number): number => {
  if (typeof v === 'string' || isArray(v)) return v.length;
  let n = 0;
  if (typeof v === 'object' && v) {
    for (const key in v) {
      if (++n > room) break;
    }
  }
  return n || 1;
};

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
 * What one replacement adds to the receiver's length, at most. With a string
 * pattern only `` $` `` and `$'` can insert the text before or after the match
 * (up to the whole receiver) and `$&` the match itself; every other `$` form
 * is literal or shrinks, so it costs its own length.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a $ in a replacement is charged only for what it can insert"
 */
const grow = (r: unknown, args: unknown[]): number => {
  const what = toText(args[0]);
  const by = toText(args[1]);
  const times = (token: string): number => by.split(token).length - 1;
  return max(0, by.length + times('$&') * what.length + (times('$`') + times("$'")) * len(r) - what.length);
};

/**
 * Natives that read their arguments as values, never as text, so their
 * arguments are not charged as text. The predicates (`items.filter(Boolean)`
 * applies one to every element) cost nothing; the others have a row that
 * charges what they read: a shallow count of elements or keys.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a predicate native reads a large argument for free"
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a native that reads its argument as data is charged its element count, not its text"
 */
export const DATA_ARGS: ReadonlySet<string> = new Set([
  'Array.isArray', 'Boolean', 'Number.isFinite', 'Number.isInteger', 'Number.isNaN',
  'Array.from', 'Object.entries', 'Object.keys', 'Object.values',
  'array.concat', 'array.includes', 'array.indexOf', 'array.lastIndexOf',
]);

/**
 * One row per native whose cost grows with its receiver or with a size or
 * count argument. Keys are `array.<method>`, `string.<method>`, or the label
 * a global carries (`Array.from`).
 *
 * - `array.sort` charges n log n comparisons. The default order converts both
 *   elements to text at every comparison, so an element that is an array adds
 *   its text weight each time.
 * - `every`, `some` and `reduce` skip holes without calling back, so on a
 *   sparse array the step budget does not bound them. A hole measured about
 *   the cost of an array slot, so they cost the receiver's length.
 * - `includes`, `indexOf` and `lastIndexOf` compare the search value without
 *   converting it, but convert `fromIndex` to a number: that is weighed as text.
 * - `Array.from` converts an array-like's `length` to a number, so the
 *   array-like is weighed as text before that conversion.
 * - `Object.keys` / `values` / `entries` charge 16 per element or key: listing
 *   an object's keys, or a string's index keys, measured several array slots
 *   per key.
 * - The string rows that amplify nothing (their output is at most a small
 *   constant times the receiver) are weighted by their measured cost per
 *   character against an `Array.from` slot (about 110 ns at 4x CPU
 *   throttling), by `node scripts/measure-alloc-budget.mjs --chars`. Case
 *   mapping is tiered by the costliest character (`costly`, then `nonAscii`):
 *   lowercasing a string stored one byte a character measured at most 2.1 ns,
 *   and anything costly up to 34 ns (Turkish `İ`); uppercasing ASCII 1.3 ns,
 *   Latin-1 up to 32 ns (`ß` and `ÿ` widen), and costly text up to 64 ns (`ΐ`
 *   becomes three characters). The cheap tier also takes text stored two bytes
 *   a character whose characters above U+00FF are only those self-mapping
 *   symbols, so one curly apostrophe in a record does not price it as Greek.
 *   A string stored two bytes a character costs more for the same text
 *   (lowercasing 4 to 11 ns, plus the tier scan's 3.5 ns) than the 1/32 its
 *   tier charges: up to about fourfold. A text search over 9,000 records with
 *   such characters still measured under 50 ms; a single long two-byte string
 *   does not, and SECURITY.md lists it under FORMA-028. The tier test is
 *   itself a scan (free on one-byte strings), skipped when even the cheapest
 *   tier is past `room`.
 * - `includes`, `indexOf` and `lastIndexOf` on a string are weighted for
 *   ordinary text, under 1 ns a character. A pattern whose first characters
 *   fill the receiver (`'ab'` in `'aaaa…'`) measured 39 ns: SECURITY.md lists
 *   it with the other content-dependent costs (FORMA-028).
 */
export const COSTS: Readonly<Record<string, Cost>> = Object.create(null) as Record<string, Cost>;

function rows(cost: Cost, names: string): void {
  for (const name of names.split(' ')) (COSTS as Record<string, Cost>)[name] = cost;
}

// The result is a copy of the receiver, or no longer than it.
rows((r) => len(r), 'array.filter array.flatMap array.map array.reverse array.slice string.concat');
// Shared or sliced, or read only as far as the argument: flattening a
// concatenated receiver measured about 1 ns a character.
rows((r) => len(r) / 64, 'string.endsWith string.slice string.startsWith string.substring');
// Searched: ordinary text measured under 1 ns a character.
rows((r) => len(r) / 32, 'string.includes string.indexOf string.lastIndexOf');
// Whitespace runs measured 3.5 ns a character.
rows((r) => len(r) / 16, 'string.trim string.trimEnd string.trimStart');
rows((r, _, room) => {
  const n = len(r);
  return n / 32 > room || !costly(r as string) ? n / 32 : n / 2;
}, 'string.toLowerCase');
rows((r, _, room) => {
  const n = len(r);
  return n / 16 > room ? n / 16 : costly(r as string) ? n : nonAscii(r as string) ? n / 2 : n / 16;
}, 'string.toUpperCase');
rows((r, a, room) => len(r) / 16 + weigh(a[1], room), 'array.includes array.indexOf array.lastIndexOf');
// Every index is visited, holes included.
rows((r) => len(r), 'array.every array.reduce array.some');
rows((r, a) => {
  let n = len(r);
  for (const x of a) n += isArray(x) ? x.length : 1;
  return n;
}, 'array.concat');
rows((r, a) => max(len(r), count(a[0])), 'string.padEnd string.padStart');
rows((_, a, room) => 16 * size(a[0], room / 16), 'Object.entries Object.keys Object.values');
rows((r, a, room) => weigh(r, room, (a[0] === undefined ? 1 : count(a[0])) + 1), 'array.flat');
rows((r, a, room) => weigh(r, room) + len(r) * (a[0] === undefined ? 1 : toText(a[0]).length), 'array.join');
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
// Scanned for the separator, then one slot per piece, at most `limit` pieces.
rows((r, a) => {
  const n = len(r);
  const by = a[0] === undefined ? n : toText(a[0]).length;
  const pieces = (by ? n / by : n) + 1;
  return n / 32 + (a[1] === undefined ? pieces : min(pieces, toNumber(a[1]) >>> 0));
}, 'string.split');
rows((_, a, room) => {
  const x = a[0];
  if (typeof x === 'string' || isArray(x)) return len(x);
  const text = weigh(x, room);
  return text > room ? text : text + count((x as { length?: unknown } | null)?.length);
}, 'Array.from');
Object.freeze(COSTS);
