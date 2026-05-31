import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the WrapDrive web PWA. The dev server port is overridable so
 * the two-port interop test can run two instances side by side.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WD_WEB_PORT ?? 5173),
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
