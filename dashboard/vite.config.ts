import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the bundle works served from the bridge at any path.
// Dev: `npm run dev` proxies /api to a locally running bridge (default port).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8377',
    },
  },
});
