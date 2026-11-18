import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The deterministic duel rules are shared with the server; see docs/ARCHITECTURE.md.
      '@ronin/combat': fileURLToPath(new URL('../shared/src/combat/index.ts', import.meta.url)),
    },
  },
});
