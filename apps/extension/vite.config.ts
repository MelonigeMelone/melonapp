import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  resolve: { alias: { '@web': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@melon/wasm'] },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { popup: fileURLToPath(new URL('./src/popup.html', import.meta.url)) } },
  },
});
