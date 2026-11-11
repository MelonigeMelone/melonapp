import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@melon/wasm'] },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' },
  },
  build: { target: 'es2022' },
});
