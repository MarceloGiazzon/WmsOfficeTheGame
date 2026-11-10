/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Backend NPDev (WmsOfficeTheGame) roda em :8200. Em dev, /api é repassado para ele (mesma origem, sem CORS).
const NPDEV_URL = process.env.NPDEV_URL ?? 'http://localhost:8200';

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
