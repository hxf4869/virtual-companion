import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

function stBrowserGlobalsPlugin() {
    return {
        name: 'vc-vitest-st-browser-globals',
        resolveId(source) {
            if (source === '/lib.js' || source === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
                return `\0${source}`;
            }
            return null;
        },
        load(id) {
            if (id === '\0/lib.js') {
                return `
                    export const klona = v => structuredClone(v);
                    export const lodash = Object.assign(v => ({ value: () => v }), {
                        get: (o, p, d) => d,
                        set: (o, p, v) => o,
                        merge: (t, s) => Object.assign(t, s),
                        cloneDeep: v => structuredClone(v),
                        isEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
                        omitBy: (o, fn) => o,
                    });
                    export const yaml = { parse: JSON.parse, stringify: JSON.stringify };
                    export const showdown = { Converter: class { addExtension() {} makeHtml(t) { return String(t ?? ''); } } };
                    export const hljs = { highlightElement() {} };
                    export const DOMPurify = { sanitize: s => String(s ?? ''), addHook() {} };
                    export const css = { parse() { return {}; }, stringify() { return ''; } };
                    export const chevrotain = { createToken: cfg => ({ ...cfg, name: cfg?.name }), Lexer: class { static SKIPPED = 'SKIPPED'; }, CstParser: class { RULE(n, fn) { return fn; } performSelfAnalysis() {} } };
                    export const moment = () => ({ format: () => '', valueOf: () => 0 });
                    export const seedrandom = () => () => 0.5;
                    export const droll = { roll: () => ({ total: 1 }) };
                    export const Handlebars = { compile: () => () => '', create: () => ({ registerHelper() {}, compile: () => () => '' }) };
                    export const Bowser = { getParser: () => ({ getBrowserName: () => 'Chrome' }) };
                `;
            }
            if (id === '\0/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
                return `
                    export async function initializeDesktop() {
                        const s = { any: () => s, string: () => s, number: () => s, boolean: () => s, array: () => s, object: () => s, enum: () => s, optional: () => s, nullable: () => s, default: () => s, describe: () => s, passthrough: () => s, union: () => s, record: () => s, literal: () => s, tuple: () => s, function: () => ({ args: () => ({ returns: () => ({ implement: fn => fn }) }), implement: fn => fn }), parse: v => v, safeParse: v => ({ success: true, data: v }) };
                        return { z: s, settings: {}, async render() {} };
                    }
                `;
            }
            return null;
        },
    };
}

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    cacheDir: fileURLToPath(new URL('../node_modules/.vite', import.meta.url)),
    plugins: [react(), stBrowserGlobalsPlugin()],
    resolve: {
        alias: {
            '/scripts/vc-runtime/source-identity.js': fileURLToPath(
                new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url),
            ),
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.{ts,tsx}'],
    },
});
