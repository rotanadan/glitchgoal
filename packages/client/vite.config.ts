import { defineConfig } from 'vite';

export default defineConfig({
  // The .env lives at the monorepo root, not in this package.
  envDir: '../..',
  server: { port: 5173 },
  build: { target: 'es2022' },
});
