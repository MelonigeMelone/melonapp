import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /.*\/crypto\/client$/, replacement: fileURLToPath(new URL('./src/crypto.ts', import.meta.url)) }],
  },
  build: { target: 'es2022' },
  server: { strictPort: true },
});
