import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    // Vite 7 rejects unknown Host headers by default. Allow the VM preview
    // hostname via env (VITE_ALLOWED_HOST) so we never hardcode it in source.
    allowedHosts: process.env.VITE_ALLOWED_HOST ? [process.env.VITE_ALLOWED_HOST] : [],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
