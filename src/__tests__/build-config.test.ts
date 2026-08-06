/**
 * Build-configuration contract tests.
 *
 * Each case pins a property of tsup.config.ts that a doc, a comment or the
 * exports map depends on. They run against the config object itself, so they
 * need no build and cannot go stale against a cached dist/. The artifact-level
 * counterparts live in scripts/verify-dist.mjs, which `npm run build` runs last.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Options } from 'tsup';
import rawConfig from '../../tsup.config';
import { DEV_BUILD_FLAG, BROWSER_ESM_OUTPUT } from '../../scripts/build-defines.mjs';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const configs = rawConfig as Options[];

/** Entry names (output basenames without extension) of one tsup config. */
function entryNames(config: Options): string[] {
  return Object.keys(config.entry as Record<string, string>);
}

/** Apply a config's esbuildOptions hook to a probe object and return it. */
function esbuildOptionsOf(config: Options): Record<string, unknown> {
  const probe: Record<string, unknown> = {};
  (config.esbuildOptions as ((o: unknown) => void) | undefined)?.(probe);
  return probe;
}

describe('tsup configuration', () => {
  it('never cleans dist from inside a parallel config', () => {
    // tsup builds these configs concurrently. A `clean` in any of them races
    // the others: it used to delete the hardened runtime's declaration files
    // after another config had already written them, so which bytes shipped
    // depended on scheduler timing. `npm run build` cleans once, up front.
    for (const config of configs) {
      expect(config.clean, JSON.stringify(entryNames(config))).toBeFalsy();
    }
    expect(pkg.scripts.build).toMatch(/^node scripts\/clean-dist\.mjs && tsup\b/);
  });

  it('hard-defines the dev flag in every artifact', () => {
    for (const config of configs) {
      expect(config.define?.[DEV_BUILD_FLAG], JSON.stringify(entryNames(config))).toBe('false');
    }
  });

  it('enables syntax minification everywhere so the build-time flags fold', () => {
    // Without it esbuild leaves `__DEV__` and the eval-capability constant as
    // variables nothing reads at build time, so dev warnings and the
    // `new Function` fallback both survive into the shipped bytes.
    for (const config of configs) {
      expect(esbuildOptionsOf(config).minifySyntax, JSON.stringify(entryNames(config))).toBe(true);
      expect(config.minify, 'identifier/whitespace minification must stay off').toBeFalsy();
    }
  });

  it('builds a self-contained browser ESM bundle for the CDN recipe', () => {
    // The documented `<script type="module">` recipe used to point at
    // dist/index.js, which code-splits and imports the bare specifier
    // "alien-signals" — a browser has no resolver for either.
    const expectedEntry = BROWSER_ESM_OUTPUT.replace(/^dist\//, '').replace(/\.js$/, '');
    const browser = configs.find((c) => entryNames(c).includes(expectedEntry));
    expect(browser, `a config emitting ${BROWSER_ESM_OUTPUT}`).toBeDefined();
    expect(browser!.format).toEqual(['esm']);
    expect(browser!.splitting).toBe(false);
    expect(browser!.platform).toBe('browser');
    // Every runtime dependency must be inlined, or the artifact is not
    // loadable from a CDN.
    const noExternal = browser!.noExternal ?? [];
    for (const dep of Object.keys(pkg.dependencies)) {
      const inlined = noExternal.some((rule) =>
        rule instanceof RegExp ? rule.test(dep) : rule === dep
      );
      expect(inlined, `${dep} must be inlined into ${BROWSER_ESM_OUTPUT}`).toBe(true);
    }
  });

  it('keeps dependencies external for the Node-facing entries', () => {
    // The inverse of the rule above: consumers resolving @getforma/core through
    // the exports map must all share one alien-signals instance.
    const main = configs.find((c) => entryNames(c).includes('index') && c.splitting === true);
    expect(main, 'the code-split ESM/CJS config').toBeDefined();
    expect(main!.noExternal ?? []).toEqual([]);
  });

  it('ships a build entry for every dist file the exports map promises', () => {
    // ./wasm shipped in the CHANGELOG for five minor versions with no build
    // entry, no dist output and no exports key, so importing it always failed.
    const built = new Set(configs.flatMap(entryNames));
    const promised = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === 'string') {
        const m = /^\.\/dist\/(.+)\.(?:js|cjs)$/.exec(node);
        if (m) promised.add(m[1]);
        return;
      }
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(pkg.exports);
    for (const name of [...promised].sort()) {
      expect(built.has(name), `exports promises dist/${name} but no tsup entry builds it`).toBe(true);
    }
  });
});
