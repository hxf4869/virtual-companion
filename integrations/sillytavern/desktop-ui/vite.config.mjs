import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { applySpecToText } from '../scripts/lib/patcher.mjs';

const EJS_DIST_INDEX = fileURLToPath(
    new URL('../upstream/ST-Prompt-Template/dist/index.js', import.meta.url),
);
const EJS_DESKTOP_QUERY_ID = `${EJS_DIST_INDEX}?vc-ejs-desktop`;
const EJS_PATCH_SPEC = fileURLToPath(
    new URL('../patches/ejs-desktop-runtime.json', import.meta.url),
);
const EJS_HOST_FILE = fileURLToPath(
    new URL('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js', import.meta.url),
);

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

function ejsDesktopRuntimePlugin() {
    return {
        name: 'vc-ejs-desktop-runtime',
        resolveId(source, importer) {
            if (source === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
                return EJS_DESKTOP_QUERY_ID;
            }
            if (
                source ===
                '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/ejs-host.js'
            ) {
                return EJS_HOST_FILE;
            }
            if (importer === EJS_DESKTOP_QUERY_ID) {
                if (source === '../../../../../lib.js') {
                    return { id: '/lib.js', external: true };
                }
                if (source.startsWith('.')) {
                    return path.resolve(path.dirname(EJS_DIST_INDEX), source);
                }
            }
            return null;
        },
        load(target) {
            if (target !== EJS_DESKTOP_QUERY_ID) return null;
            const input = fs.readFileSync(EJS_DIST_INDEX, 'utf8');
            const spec = JSON.parse(fs.readFileSync(EJS_PATCH_SPEC, 'utf8'));
            return applySpecToText(input, spec).output;
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
    plugins: [react(), appStartupCssPlugin(), ejsDesktopRuntimePlugin()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        target: 'es2020',
        outDir: fileURLToPath(new URL('../server-plugin/virtual-companion/desktop/app/', import.meta.url)),
        emptyOutDir: true,
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
            external: [
                '/lib.js',
                '/scripts/vc-runtime/source-identity.js',
            ],
        },
    },
});

export default defineConfig(() => (process.env.VC_DESKTOP_TARGET === 'app' ? app : bridge));
