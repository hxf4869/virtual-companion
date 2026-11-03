import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        target: 'es2020',
        lib: { entry: fileURLToPath(new URL('./src/index.tsx', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
        outDir: fileURLToPath(new URL('../extension/vc-model-settings/desktop/build/', import.meta.url)),
        emptyOutDir: true,
        sourcemap: false,
    },
});
