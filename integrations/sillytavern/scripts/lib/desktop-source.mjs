import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { init, parse } from 'es-module-lexer';
import ts from 'typescript';
import { EJS_DESKTOP_PATCH_SPEC, EJS_DIR, EXTENSION_SRC, HELPER_DIR, INTEG, ST_DIR } from './paths.mjs';
import { applySpecToText } from './patcher.mjs';
import { prepareHelperPackages, verifyDesktopInputs, verifyDesktopVendorContract } from './desktop-source-inputs.mjs';
import { desktopSourceModules } from './desktop-source-modules.mjs';
import { readJson, run } from './util.mjs';

export const DESKTOP_SOURCE_DIR = path.join(EXTENSION_SRC, 'desktop/locked-source');
const standaloneDir = path.join(EXTENSION_SRC, 'desktop/standalone');

await init();

export function rewriteDesktopImports(source, importer, imports) {
    for (const item of parse(source, importer)[0].reverse()) {
        if (item.type === 'import-meta') continue;
        const specifier = item.specifier;
        if (!specifier) throw new Error(`${importer}: computed dynamic import`);
        if (!Object.hasOwn(imports, specifier)) throw new Error(`${importer}: unapproved import ${specifier}`);
        const literal = item.type === 'dynamic' ? JSON.stringify(imports[specifier]) : imports[specifier];
        source = source.slice(0, item.start) + literal + source.slice(item.end);
    }
    return source;
}

function relativeModule(from, to) {
    const target = to.startsWith('@port/') ? path.join(standaloneDir, to.slice(6)) : path.join(DESKTOP_SOURCE_DIR, to);
    const rel = path.relative(path.dirname(path.join(DESKTOP_SOURCE_DIR, from)), target).split(path.sep).join('/');
    return rel.startsWith('.') ? rel : `./${rel}`;
}

function selectDeclarations(source, filename, names) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const selected = new Map();
    for (const statement of file.statements) {
        const name = ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
            ? statement.declarationList.declarations[0].name.getText(file)
            : statement.name?.getText(file);
        if (names.includes(name)) selected.set(name, statement.getFullText(file));
    }
    if (selected.size !== names.length) throw new Error(`${filename}: missing declarations ${names.filter(name => !selected.has(name))}`);
    return [...selected.values()].join('\n');
}

function omitDesktopUi(source, filename, exclusions) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const removed = [];
    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement) && exclusions.imports?.includes(statement.moduleSpecifier.text)) {
            removed.push(statement);
        }
        if (ts.isClassDeclaration(statement)) {
            for (const member of statement.members) {
                if (exclusions.methods?.includes(member.name?.getText(file))) removed.push(member);
            }
        }
    }
    if (removed.length !== (exclusions.imports?.length ?? 0) + (exclusions.methods?.length ?? 0)) {
        throw new Error(`${filename}: desktop UI omissions no longer match`);
    }
    for (const node of removed.reverse()) source = source.slice(0, node.getFullStart()) + source.slice(node.end);
    return source;
}

function selectObjectMembers(source, filename, selections) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    for (const statement of [...file.statements].reverse()) {
        if (!ts.isVariableStatement(statement)) continue;
        const [declaration] = statement.declarationList.declarations;
        const names = selections[declaration.name.getText(file)];
        if (!names) continue;
        const object = declaration.initializer;
        const properties = object.properties.filter(item => names.includes(item.name.getText(file)));
        if (properties.length !== names.length) throw new Error(`${filename}: desktop object members no longer match`);
        source = source.slice(0, object.getStart(file)) + `{ ${properties.map(item => item.getText(file)).join(', ')} }` + source.slice(object.end);
    }
    return source;
}

function transformSource(source, filename, config) {
    if (config.select) source = selectDeclarations(source, filename, config.select);
    if (config.objectMembers) source = selectObjectMembers(source, filename, config.objectMembers);
    if (config.omitUi) source = omitDesktopUi(source, filename, config.omitUi);
    for (const [before, after, count = 1] of config.replace ?? []) {
        if (source.split(before).length - 1 !== count) throw new Error(`${filename}: host adaptation no longer matches`);
        source = source.replaceAll(before, after);
    }
    if (filename.startsWith('helper/')) {
        source = ts.transpileModule(source, {
            fileName: filename.replace(/\.js$/, '.ts'),
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText;
    }
    const imports = Object.fromEntries(Object.entries(config.imports ?? {}).map(([spec, to]) => [spec, relativeModule(filename, to)]));
    source = rewriteDesktopImports(source, filename, imports);
    if (config.expose) source += `\nexport { ${config.expose.join(', ')} };\n`;
    if (config.factory) {
        const { name, params, exports } = config.factory;
        // The selected upstream declarations have named exports only. Instantiate their registry per card host.
        for (const binding of exports) {
            const pattern = new RegExp(`^export (const|function) ${binding}\\b`, 'm');
            if (!pattern.test(source)) throw new Error(`${filename}: missing factory member ${binding}`);
            source = source.replace(pattern, `$1 ${binding}`);
        }
        source = `export function ${name}(${params}) {\n${source}\nreturn { ${exports.join(', ')} };\n}\n`;
    }
    const bindings = Object.entries(config.bindings ?? {}).map(([to, names]) =>
        `import { ${names} } from ${JSON.stringify(relativeModule(filename, to))};\n`).join('');
    return bindings + source;
}

const libraryImports = {
    lodash: 'lodash', DOMPurify: 'dompurify', hljs: 'highlight.js', Handlebars: 'handlebars',
    css: '@adobe/css-tools', Bowser: 'bowser', showdown: 'showdown', moment: 'moment',
    seedrandom: 'seedrandom', droll: 'droll', yaml: 'yaml', chevrotain: 'chevrotain',
};

function desktopLibEntry() {
    const filename = path.join(ST_DIR, 'public/lib.js');
    const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = [];
    for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const clause = statement.importClause;
        const name = clause.name?.text ?? (ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : undefined);
        if (!Object.hasOwn(libraryImports, name)) continue;
        if (statement.moduleSpecifier.text !== libraryImports[name]) throw new Error(`Unexpected ST lib import: ${name}`);
        imports.push(statement.getText(file));
    }
    if (imports.length !== Object.keys(libraryImports).length) throw new Error('Missing locked ST lib imports');
    return `${imports.join('\n')}
export { ${Object.keys(libraryImports).join(', ')} };
export { klona } from 'klona';
export { omitDeepBy } from 'lodash-omitdeep';
export { default as helperYaml } from 'vc-helper-yaml';
export { z as helperZod } from 'zod';
`;
}

function packageNotice(directory, name, version) {
    const license = fs.readdirSync(directory).find(file => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(file));
    const text = license
        ? fs.readFileSync(path.join(directory, license), 'utf8')
        : name === 'seedrandom' ? fs.readFileSync(path.join(directory, 'seedrandom.js'), 'utf8').match(/^\/\*([\s\S]*?)\*\//)?.[1].trim() : null;
    if (!text) throw new Error(`Missing desktop library license: ${name}`);
    return `${name}@${version}\n\n${text}`;
}

async function buildLibrary(stage, helperPackages) {
    const requireST = createRequire(path.join(ST_DIR, 'package.json'));
    const webpack = requireST('webpack');
    const stDir = fs.realpathSync(ST_DIR);
    const stNodeModules = path.join(stDir, 'node_modules');
    const stLock = readJson(path.join(stDir, 'package-lock.json'));
    const modules = path.join(stage, '.helper/node_modules');
    const helperNotices = [];
    for (const { name, version, archive } of helperPackages) {
        const directory = path.join(modules, name);
        fs.mkdirSync(directory, { recursive: true });
        run('tar', ['-xzf', archive, '--strip-components=1', '-C', directory]);
        helperNotices.push(packageNotice(directory, name, version));
    }
    const entry = path.join(stage, '.lib-entry.mjs');
    fs.writeFileSync(entry, desktopLibEntry());
    const compiler = webpack({
        mode: 'production',
        target: ['web', 'es2020'],
        entry,
        devtool: false,
        cache: false,
        resolve: {
            modules: [modules, stNodeModules],
            alias: {
                'yaml$': path.join(stNodeModules, 'yaml'),
                'vc-helper-yaml$': path.join(modules, 'yaml'),
            },
        },
        optimization: { concatenateModules: false, splitChunks: false },
        experiments: { outputModule: true },
        performance: false,
        output: { path: path.join(stage, 'st'), filename: 'lib.js', library: { type: 'module' } },
    });
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => {
        compiler.close(closeError => {
            if (error || closeError) reject(error ?? closeError);
            else resolve(stats);
        });
    }));
    if (stats.hasErrors() || stats.hasWarnings()) throw new Error(stats.toString({ all: false, errors: true, warnings: true }));
    const packages = new Map();
    for (const module of stats.compilation.modules) {
        const resource = module.nameForCondition();
        if (!resource || resource === entry || resource.startsWith(`${modules}${path.sep}`)) continue;
        const rel = path.relative(stDir, resource).split(path.sep).join('/');
        const owner = rel.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
        const lock = stLock.packages[owner];
        if (!lock || lock.dev) throw new Error(`Unexpected desktop library module: ${resource}`);
        packages.set(owner, lock.version);
    }
    fs.rmSync(entry);
    fs.rmSync(path.dirname(modules), { recursive: true });
    return [
        ...[...packages].sort().map(([dir, version]) => {
            const packageDir = path.join(stDir, dir);
            return packageNotice(packageDir, readJson(path.join(packageDir, 'package.json')).name, version);
        }),
        ...helperNotices,
    ];
}

function sourceFile(output, config) {
    const [, component, relative] = output.match(/^([^/]+)\/(.+)$/);
    if (component === 'st') return path.join(ST_DIR, config.from ?? `public/${relative}`);
    if (component === 'helper') return path.join(HELPER_DIR, 'src', relative.replace(/\.js$/, '.ts'));
    return path.join(EJS_DIR, relative === 'desktop.js' ? 'dist/index.js' : relative);
}

function verifyGraph(stage) {
    const files = new Set(['st/lib.js', ...Object.keys(desktopSourceModules)]);
    const ports = new Set(Object.values(desktopSourceModules).flatMap(config =>
        [...Object.values(config.imports ?? {}), ...Object.keys(config.bindings ?? {})]
            .filter(target => target.startsWith('@port/'))
            .map(target => path.join(standaloneDir, target.slice(6)))));
    for (const file of files) {
        const source = fs.readFileSync(path.join(stage, file), 'utf8');
        for (const item of parse(source, file)[0]) {
            if (item.type === 'import-meta') continue;
            const specifier = item.specifier;
            const actual = specifier?.startsWith('.') && path.resolve(DESKTOP_SOURCE_DIR, path.dirname(file), specifier);
            const relative = actual && path.relative(DESKTOP_SOURCE_DIR, actual).split(path.sep).join('/');
            if (files.has(relative) && fs.existsSync(path.join(stage, relative))) continue;
            if (ports.has(actual) && fs.statSync(actual, { throwIfNoEntry: false })?.isFile()) continue;
            throw new Error(`${file}: unresolved desktop source graph edge ${specifier ?? '<computed>'}`);
        }
    }
}

export async function generateDesktopSource() {
    const lock = verifyDesktopInputs();
    const helperPackages = prepareHelperPackages({ offline: true });
    verifyDesktopVendorContract();
    const stage = `${DESKTOP_SOURCE_DIR}.tmp`;
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    try {
        for (const [file, config] of Object.entries(desktopSourceModules)) {
            let source = fs.readFileSync(sourceFile(file, config), 'utf8');
            if (file === 'ejs/desktop.js') {
                source = applySpecToText(source, readJson(EJS_DESKTOP_PATCH_SPEC)).output;
            }
            const destination = path.join(stage, file);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, transformSource(source, file, config));
        }
        const notices = await buildLibrary(stage, helperPackages);
        verifyGraph(stage);
        for (const [id, dir] of [['sillytavern', ST_DIR], ['tavern-helper', HELPER_DIR], ['ejs-template', EJS_DIR]]) {
            const { version, commit, license, repo } = lock.components.find(item => item.id === id);
            notices.push(`${id}@${version} (${license})\n${repo}/tree/${commit}\n\n${fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8')}`);
        }
        notices.push(fs.readFileSync(path.join(INTEG, 'desktop-ui/LOCKED_RUNTIME_NOTICES.txt'), 'utf8').trimEnd());
        const content = `${notices.join('\n\n---\n\n')}\n`;
        fs.writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), content);
        fs.rmSync(DESKTOP_SOURCE_DIR, { recursive: true, force: true });
        fs.renameSync(stage, DESKTOP_SOURCE_DIR);
        return content;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}
