import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

/**
 * Vite config for the WrapDrive desktop renderer plus the Electron main/preload
 * processes. The renderer is a React SPA; the main process hosts the Node
 * transfer engine and the preload exposes a typed, context-isolated bridge.
 */
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: 'dist',
  },
});
