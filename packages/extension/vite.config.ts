import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      '@lale/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'src/sidepanel/index.html'),
      },
    },
  },
});
