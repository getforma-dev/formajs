import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const srcDirWithSlash = `${srcDir}/`;

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
  resolve: {
    alias: [
      { find: /^forma\/(.*)$/, replacement: `${srcDirWithSlash}$1` },
      { find: 'forma', replacement: srcDir },
    ],
  },
});
