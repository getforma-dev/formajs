/**
 * SR33's table (DR-16): every allowlisted native, and the hostile size that
 * must be refused before it runs. Shared by the unit test
 * (`native-cost.test.ts`, in Node) and the browser test (`e2e/sr33.spec.ts`,
 * Chromium at 4x CPU throttling, then Firefox and WebKit), so the two check one
 * table and cannot drift apart.
 *
 * Not a `.test.ts` file, so vitest never collects it as a suite.
 */
import { ARRAY_METHODS, HOF_CALLBACK_PARAMS, NUMBER_METHODS, SAFE_GLOBALS, STRING_METHODS } from '../allowlist';

/**
 * Build the hostile values. Self-contained, with no reference outside its own
 * body, because Playwright runs it inside the page by its source text.
 */
export function hostileFixtures(): { state: Record<string, unknown>; objects: object[]; strings: string[] } {
  /** 1,000 references to one 300,000-character string: 300 million characters as text, a few KB in memory. */
  const LONG = 'x'.repeat(300_000);
  const big = Array.from({ length: 1000 }, () => LONG);
  /** Receivers whose size alone is over the budget. */
  const bigArr = Array.from({ length: 500_000 }, (_, i) => i);
  const bigStr = 'y'.repeat(500_000);
  /** Over the budget only through the cost row's multiplier or second term. */
  const midStr = 'z'.repeat(150_000);
  const keysStr = 'k'.repeat(60_000);
  const short = 'q'.repeat(1000);
  const sortable = Array.from({ length: 30_000 }, (_, i) => (i * 7919) % 30_000);
  const inner = Array.from({ length: 1000 }, (_, i) => i);
  const nested = Array.from({ length: 1000 }, () => inner);
  /** Scans are charged a sixty-fourth to a sixteenth per element, so these are over 64x the budget. */
  const hugeArr = new Array<number>(7_000_000);
  const hugeStr = 's'.repeat(17_000_000);
  const wide = Array.from({ length: 150_000 }, () => 0);
  /** 20,000 own keys: a data-argument native reads 16 units per key. */
  const bigObj = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, i]));
  return {
    state: { big, bigArr, bigStr, midStr, keysStr, short, sortable, nested, hugeArr, hugeStr, wide, bigObj },
    objects: [big, bigArr, sortable, nested, hugeArr, wide, bigObj],
    strings: [LONG, bigStr, midStr, keysStr, short, hugeStr],
  };
}

/** One hostile size per cost row: a receiver, a count or a length over the budget. */
export const SIZE_CASES: Readonly<Record<string, string>> = {
  'array.concat': 'bigArr.concat()',
  'array.every': 'hugeArr.every(x => x)',
  'array.filter': 'bigArr.filter(x => x)',
  'array.flat': 'nested.flat()',
  'array.flatMap': 'bigArr.flatMap(x => x)',
  'array.includes': 'hugeArr.includes(1)',
  'array.indexOf': 'hugeArr.indexOf(1)',
  'array.join': 'bigArr.join()',
  'array.lastIndexOf': 'hugeArr.lastIndexOf(1)',
  'array.map': 'bigArr.map(x => x)',
  'array.reduce': 'hugeArr.reduce((a, x) => a, 0)',
  'array.reverse': 'bigArr.reverse()',
  'array.slice': 'bigArr.slice()',
  'array.some': 'hugeArr.some(x => x)',
  'array.sort': 'sortable.sort()',
  'string.concat': 'bigStr.concat()',
  'string.endsWith': "hugeStr.endsWith('s')",
  'string.includes': "hugeStr.includes('t')",
  'string.indexOf': "hugeStr.indexOf('t')",
  'string.lastIndexOf': "hugeStr.lastIndexOf('t')",
  'string.padEnd': 'short.padEnd(12000000)',
  'string.padStart': 'short.padStart(12000000)',
  'string.repeat': 'short.repeat(10000)',
  'string.replace': "bigStr.replace('y', 'z')",
  'string.replaceAll': "midStr.replaceAll('', '-')",
  'string.slice': 'hugeStr.slice(0, 1)',
  'string.split': "bigStr.split('')",
  'string.startsWith': "hugeStr.startsWith('s')",
  'string.substring': 'hugeStr.substring(0, 1)',
  'string.toLowerCase': 'hugeStr.toLowerCase()',
  'string.toUpperCase': 'hugeStr.toUpperCase()',
  'string.trim': 'hugeStr.trim()',
  'string.trimEnd': 'hugeStr.trimEnd()',
  'string.trimStart': 'hugeStr.trimStart()',
  'Array.from': 'Array.from({length: 12000000})',
  'Object.entries': 'Object.entries(keysStr)',
  'Object.keys': 'Object.keys(keysStr)',
  'Object.values': 'Object.values(keysStr)',
};

/** Data-argument natives with a row: a shallowly huge argument, or a `fromIndex` heavy as text. */
export const DATA_CASES: Readonly<Record<string, string>> = {
  'Array.from': 'Array.from(bigArr)',
  'Object.entries': 'Object.entries(bigArr)',
  'Object.keys': 'Object.keys(bigArr)',
  'Object.values': 'Object.values(bigArr)',
  'array.concat': 'items.concat(bigArr)',
  'array.includes': 'items.includes(1, big)',
  'array.indexOf': 'items.indexOf(1, big)',
  'array.lastIndexOf': 'items.lastIndexOf(1, big)',
};

export interface Callable {
  /** As the cost table names it: `array.map`, `string.slice`, `Array.from`. */
  name: string;
  /** Where the intrinsic lives, as a path from the global object (`Array.prototype`, `Math`, or '' for the global itself). */
  owner: string;
  key: string;
  /** The call, with `arg` as its data argument (after a callback, for the higher-order methods). */
  call: (arg: string) => string;
}

function callback(method: string): string {
  if (method === 'sort') return '(a, b) => a - b';
  if (method === 'reduce') return '(a, x) => a';
  return 'x => x';
}

/** Every callable the allowlist grants, read from its tables. */
export function callables(): Callable[] {
  const out: Callable[] = [];
  for (const m of Object.keys(ARRAY_METHODS)) {
    const hof = Object.hasOwn(HOF_CALLBACK_PARAMS, m);
    out.push({
      name: `array.${m}`, owner: 'Array.prototype', key: m,
      call: (arg) => (hof ? `items.${m}(${callback(m)}${arg ? `, ${arg}` : ''})` : `items.${m}(${arg})`),
    });
  }
  for (const m of Object.keys(STRING_METHODS)) {
    out.push({ name: `string.${m}`, owner: 'String.prototype', key: m, call: (arg) => `s.${m}(${arg})` });
  }
  for (const m of Object.keys(NUMBER_METHODS)) {
    out.push({ name: `number.${m}`, owner: 'Number.prototype', key: m, call: (arg) => `n.${m}(${arg})` });
  }
  for (const [g, host] of Object.entries(SAFE_GLOBALS)) {
    if (host.kind === 'fn') out.push({ name: g, owner: '', key: g, call: (arg) => `${g}(${arg})` });
    for (const [m, v] of Object.entries(host.members ?? {})) {
      if (typeof v !== 'function') continue;
      out.push({ name: `${g}.${m}`, owner: g, key: m, call: (arg) => `${g}.${m}(${arg})` });
    }
  }
  return out;
}

/** The object a `Callable.owner` path names, from `root` (the global object, in Node or in a page). */
export function ownerOf(root: object, path: string): object {
  let at: unknown = root;
  for (const part of path.split('.').filter(Boolean)) at = Reflect.get(at as object, part);
  return at as object;
}
