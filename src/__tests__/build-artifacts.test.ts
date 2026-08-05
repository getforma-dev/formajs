/**
 * Artifact-shape proofs.
 *
 * These run the REAL tsup configs from tsup.config.ts into a temp directory and
 * assert on the emitted bytes. They exist because the properties below are
 * claimed by comments and docs but are not observable from the source: each one
 * depends on the build pipeline (esbuild's `define` folding, its syntax-level
 * constant inlining, and tsup's Rollup tree-shaking pass) rather than on
 * anything the runtime does. Reproducing only part of that pipeline would prove
 * the wrong thing — a plain esbuild bundle of src/runtime.ts still contains
 * `new Function(` even with the hardened define.
 *
 * The whole-dist equivalents run in scripts/verify-dist.mjs, the last step of
 * `npm run build`, so CI, the release workflow and prepublishOnly enforce them
 * against the actually published files too.
 */
import { describe, it, expect } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../tsup.config';
import { EVAL_MODE_FLAG, BROWSER_ESM_OUTPUT } from '../../scripts/build-defines.mjs';
import { parseImportSpecifiers } from '../../scripts/check-size.mjs';

const configs = rawConfig as Options[];

/** Locate a config by one of its entry names. */
function configFor(entryName: string): Options {
  const found = configs.find((c) => Object.keys(c.entry as Record<string, string>).includes(entryName));
  if (!found) throw new Error(`no tsup config emits "${entryName}"`);
  return found;
}

/**
 * Run one real config into a private temp dir and return the emitted JS.
 *
 * The config is narrowed to the single requested entry and given its own output
 * directory, so nothing another case (or another emitted entry) writes can be
 * picked up by mistake. Only declarations, source maps and the CJS twin are
 * dropped — none of them can affect what the assertions look at.
 */
async function buildEntry(entryName: string, overrides: Options = {}): Promise<string> {
  const base = configFor(entryName);
  const entrySource = (base.entry as Record<string, string>)[entryName];
  const outDir = mkdtempSync(join(tmpdir(), 'forma-build-'));
  try {
    await build({
      ...base,
      // `config: false` is essential: tsup's programmatic build otherwise loads
      // tsup.config.ts from cwd and MERGES it over these options, which both
      // makes the result nondeterministic (an array config resolves to an
      // arbitrary member) and writes into the real dist/.
      config: false,
      entry: { [entryName]: entrySource },
      format: base.format?.includes('iife') ? ['iife'] : ['esm'],
      dts: false,
      sourcemap: false,
      silent: true,
      outDir,
      ...overrides,
    });
    return readFileSync(join(outDir, `${entryName}.js`), 'utf8');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('hardened runtime build', () => {
  it('hardened builds emit no new Function at all', { timeout: 60_000 }, async () => {
    // The hardened build promises more than "does not call eval at runtime":
    // the call is not in the file, so static supply-chain analysis has nothing
    // to flag. That holds only while the eval-capability constant is folded by
    // the define AND the dead branch is removed.
    const code = await buildEntry('runtime-hardened');
    expect(code).not.toMatch(/new Function\s*\(/);
  });

  it('the standard runtime build still contains the opt-in fallback', { timeout: 60_000 }, async () => {
    // Guards the assertion above against passing for the wrong reason — e.g.
    // the fallback having been removed from the source altogether, which would
    // make the hardened build trivially clean and the claim meaningless.
    const code = await buildEntry('runtime-hardened', {
      define: { ...configFor('runtime-hardened').define, [EVAL_MODE_FLAG]: '"mutable"' },
    });
    expect(code).toMatch(/new Function\s*\(/);
  });
});

describe('browser CDN bundle', () => {
  const browserEntry = BROWSER_ESM_OUTPUT.replace(/^dist\//, '').replace(/\.js$/, '');

  it('the browser ESM CDN artifact is self-contained', { timeout: 60_000 }, async () => {
    // The documented `<script type="module">` recipe pointed at dist/index.js,
    // which code-splits and imports the bare specifier "alien-signals". A
    // browser has no resolver for either, so the module never loads. Nothing
    // may be left unresolved in the CDN artifact.
    const code = await buildEntry(browserEntry);
    expect(parseImportSpecifiers(code)).toEqual([]);
  });

  it('the code-split entry keeps its dependencies external', { timeout: 60_000 }, async () => {
    // The inverse rule: consumers resolving @getforma/core through the exports
    // map must share one alien-signals instance, so that entry must import it
    // rather than inline a private copy.
    const code = await buildEntry('index');
    expect(parseImportSpecifiers(code)).toContain('alien-signals');
  });
});
