/**
 * The raw-HTML development warnings (FORMA-126) in the bytes the build emits.
 *
 * `src/dom/trusted-html.ts` decides development with the build flag itself,
 * so the build folds the warnings away in whatever chunk the module lands in:
 * code-split ESM entries included, where an imported `__DEV__` cannot fold.
 * These tests run the real tsup configs, as deprecated-entries.test.ts does,
 * because the folding is the build's, not the source's.
 */
import { describe, expect, it } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../../tsup.config';
import { RAW_STRING_CODES } from '../trusted-html';

const configs = rawConfig as Options[];

/** What only the raw-sink development warnings carry. */
const RAW_MARKS = [...Object.values(RAW_STRING_CODES).map(([code]) => code), 'was given a plain string'];
/** What only h('script')'s development warning carries. */
const SCRIPT_MARK = 'FORMA_W_SCRIPT_ELEMENT';

/**
 * Build the tsup config that emits `entries`, narrowed to them, into a private
 * temp dir, and return every JavaScript file it wrote, chunks included.
 */
async function buildAll(entries: string[], overrides: Options = {}): Promise<Record<string, string>> {
  const base = configs.find((c) => entries.every((n) => Object.keys(c.entry as Record<string, string>).includes(n)));
  if (!base) throw new Error(`no tsup config emits ${entries.join(', ')}`);
  const entry = Object.fromEntries(entries.map((n) => [n, (base.entry as Record<string, string>)[n]]));
  const iife = base.format?.includes('iife') ?? false;
  const outDir = mkdtempSync(join(tmpdir(), 'forma-trusted-html-'));
  try {
    await build({
      ...base,
      config: false,
      entry,
      format: iife ? ['iife'] : ['esm'],
      dts: false,
      sourcemap: false,
      silent: true,
      outDir,
      ...overrides,
    });
    const files: Record<string, string> = {};
    for (const name of readdirSync(outDir, { recursive: true }) as string[]) {
      if (name.endsWith('.js')) files[name] = readFileSync(join(outDir, name), 'utf8');
    }
    return files;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * The code-split ESM entries that reach a raw sink, then the two
 * self-contained bundles: the browser ESM bundle (core, with h()) and the
 * runtime's IIFE, built by plain esbuild (no h(), so no script warning).
 */
const BUILDS: ReadonlyArray<{ name: string; entries: string[]; marks: string[] }> = [
  { name: 'code-split ESM', entries: ['index', 'runtime', 'ssr/index'], marks: [...RAW_MARKS, SCRIPT_MARK] },
  { name: 'browser ESM bundle', entries: ['forma.esm'], marks: [...RAW_MARKS, SCRIPT_MARK] },
  { name: 'runtime IIFE', entries: ['formajs-runtime'], marks: RAW_MARKS },
];

describe('the raw-HTML warnings in a production build (the real tsup configs)', () => {
  it('a production build carries none of the raw-HTML warnings, in any artifact', { timeout: 180_000 }, async () => {
    for (const { name, entries } of BUILDS) {
      const files = await buildAll(entries);
      const all = Object.values(files).join('\n');
      for (const mark of [...RAW_MARKS, SCRIPT_MARK]) expect(all, `${name}: ${mark}`).not.toContain(mark);
      // The typed path itself is there: the build dropped the warnings only.
      expect(all, name).toContain('createPolicy');
      expect(all, name).toContain('@getforma/core#trusted-types');
    }
  });

  it('a build without the production flag keeps the warnings', { timeout: 180_000 }, async () => {
    // The control for the test above: nothing replacing `__FORMA_DEV_BUILD__`
    // is a build of the source's own behaviour, warnings and all.
    for (const { name, entries, marks } of BUILDS) {
      const all = Object.values(await buildAll(entries, { define: {} })).join('\n');
      for (const mark of marks) expect(all, `${name}: ${mark}`).toContain(mark);
    }
  });
});
