import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@cat-bot': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/dist/**', '**/node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    // The package's entire previous test suite was AI-only and was removed along
    // with the AI-agent subsystem; no tests remain in this package yet.
    passWithNoTests: true,
  },
});
