import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Locally we hit the API without CORS; in production the address is set via VITE_API_URL
    proxy: {
      // Point at a deployed API with DEV_API=https://… to work on the UI
      // without running the whole backend locally
      '/api': { target: process.env.DEV_API || 'http://localhost:3000', changeOrigin: true },
    },
  },
});
