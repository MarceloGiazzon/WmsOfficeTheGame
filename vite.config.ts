/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Backend NPDev (WmsOffice) roda em :8100. Em dev, /api é repassado para ele (mesma origem, sem CORS).
const NPDEV_URL = process.env.NPDEV_URL ?? 'http://localhost:8100';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': { target: NPDEV_URL, changeOrigin: true }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
