import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __BACKEND_URL__: JSON.stringify('http://localhost:8080'),
  },
  // The hosted Spotify player page lives beside web/ and is tested from here.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
