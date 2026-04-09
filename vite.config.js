import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000,
      },
    },
    watch: {
      ignored: ['**/*.db', '**/*.db-wal', '**/*.db-shm'],
    },
  },
});
