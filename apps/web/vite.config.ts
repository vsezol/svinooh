import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    // Two bundles: what the browser downloads, and what server.mjs renders the
    // landing with. The SSR one is named .mjs so Node reads it as a module —
    // the package is CommonJS, and a bare .js would be parsed as one.
    outDir: isSsrBuild ? 'dist/server' : 'dist/client',
    emptyOutDir: true,
    ...(isSsrBuild ? { rollupOptions: { output: { entryFileNames: 'entry-server.mjs' } } } : {}),
  },
  // React and the router are bundled into the SSR file rather than imported
  // from node_modules, so the image that serves the site carries one .mjs and
  // no dependency tree at all
  ssr: { noExternal: true },
  server: {
    port: 5173,
    // Locally we hit the API without CORS; in production the address is set via VITE_API_URL
    proxy: {
      // Point at a deployed API with DEV_API=https://… to work on the UI
      // without running the whole backend locally
      '/api': { target: process.env.DEV_API || 'http://localhost:3000', changeOrigin: true },
    },
  },
}));
