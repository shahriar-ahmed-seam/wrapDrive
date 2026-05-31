import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the WrapDrive web PWA.
 *
 * `base` defaults to '/' for local dev and is set to '/wrapDrive/' for the
 * GitHub Pages project site via the WD_BASE env var (set by the Pages workflow).
 * The dev server port is overridable so the two-port interop test can run two
 * instances side by side.
 */
export default defineConfig({
  base: process.env.WD_BASE ?? '/',
  plugins: [react()],
  server: {
    port: Number(process.env.WD_WEB_PORT ?? 5173),
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
