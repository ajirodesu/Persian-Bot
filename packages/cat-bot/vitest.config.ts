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
  },
});
