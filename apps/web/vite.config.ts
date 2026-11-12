import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'ui', include: ['src/**/*.test.tsx'], environment: 'jsdom' } },
    ],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@melon/wasm'] },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' },
  },
  build: { target: 'es2022' },
});
