import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
  },
  test: {
    // The factory checks out each node's worktree under `.ergane/`, and every worktree
    // carries a full copy of this suite. Without this exclusion `npm run test` runs the
    // tests of whatever node happens to be in flight — measured: a local run picked up
    // 001-scaffold/us3's tests mid-attempt and reported 33 tests across 9 files instead
    // of 14 across 4. A gate whose result depends on what else is building is not a gate.
    exclude: ['**/node_modules/**', '**/dist/**', '.ergane/**', '.factory/**'],
  },
});