import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL(`./src/${mode}.ts`, import.meta.url)),
      formats: ['iife'],
      name: `melon_${mode}`,
      fileName: () => `${mode}.js`,
    },
  },
}));
