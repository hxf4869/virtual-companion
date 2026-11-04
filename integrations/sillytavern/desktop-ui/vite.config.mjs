import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function appStartupCssPlugin() {
    const id = 'virtual:vc-app.css';
    const resolved = `\0${id}`;
    return {
        name: 'vc-app-startup-css',
        resolveId(source) {
            return source === id ? resolved : null;
        },
        load(target) {
            return target === resolved ? '#vc-desktop-startup { padding: 24px; }\n' : null;
        },
        transform(code, target) {
            return target.endsWith('/src/app/main.tsx') ? `import '${id}';\n${code}` : null;
        },
    };
}

export const bridge = defineConfig({
    plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        target: 'es2020',
        lib: { entry: fileURLToPath(new URL('./src/bridge/index.tsx', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
        outDir: fileURLToPath(new URL('../extension/vc-model-settings/desktop/build/', import.meta.url)),
        emptyOutDir: true,
        sourcemap: false,
    },
});

export const app = defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    cacheDir: fileURLToPath(new URL('../node_modules/.vite', import.meta.url)),
    base: '/desktop/',
    plugins: [react(), appStartupCssPlugin()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        target: 'es2020',
        outDir: fileURLToPath(new URL('../server-plugin/virtual-companion/desktop/app/', import.meta.url)),
        emptyOutDir: true,
        assetsDir: 'assets',
        sourcemap: false,
    },
});

export default defineConfig(() => (process.env.VC_DESKTOP_TARGET === 'app' ? app : bridge));
