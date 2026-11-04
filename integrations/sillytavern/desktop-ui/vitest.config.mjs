import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    cacheDir: fileURLToPath(new URL('../node_modules/.vite', import.meta.url)),
    plugins: [react()],
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.{ts,tsx}'],
    },
});
