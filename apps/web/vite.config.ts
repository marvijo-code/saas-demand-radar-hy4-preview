import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const apiTarget = process.env.API_ORIGIN ?? 'http://127.0.0.1:4174';

export default defineConfig({
  // The repository runs Vite from the root (`npm run build`), so the web app pins its own
  // root instead of relying on the current working directory.
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@sdr/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 4173),
    strictPort: false,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 4173),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
