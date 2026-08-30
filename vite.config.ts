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
});
