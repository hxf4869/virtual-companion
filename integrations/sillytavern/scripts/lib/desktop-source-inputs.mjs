// The only network boundary for the desktop sources is explicit preparation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EJS_DIR, HELPER_DIR, INTEG, MEMORYCORE_DIR, MVU_DIR, ST_DIR, UPSTREAM_LOCK, VENDOR_LOCK, PATCH_SPEC } from './paths.mjs';
import { verifyStDependencyTree } from './verify.mjs';
import { readJson, run, sha256File, sha512Base64 } from './util.mjs';

const components = {
    sillytavern: ST_DIR,
    'tavern-helper': HELPER_DIR,
    'ejs-template': EJS_DIR,
    mvu: MVU_DIR,
    memorycore: MEMORYCORE_DIR,
};
const helperCache = path.join(INTEG, 'dev/desktop-source-cache');
const helperPackages = ['klona', 'lodash-omitdeep', 'yaml', 'zod'];

export function verifyLockedCheckouts(lock, selected = lock.components.map(item => item.id)) {
    for (const id of selected) {
        const dir = components[id];
        const entry = lock.components.find(item => item.id === id);
        if (!dir || !entry || !fs.existsSync(dir)) throw new Error(`Missing locked checkout ${id}. Run scripts/prepare-desktop-source.mjs`);
        if (run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim() !== entry.commit ||
            run('git', ['-C', dir, 'status', '--porcelain']).trim()) {
            throw new Error(`Checkout ${id} must be clean at ${entry.commit}`);
        }
        for (const [rel, expected] of Object.entries(entry.artifact_sha256 ?? {})) {
            if (sha256File(path.join(dir, rel)) !== expected) throw new Error(`Locked input mismatch: ${id}/${rel}`);
        }
    }
}

export function ensureLockedStDependencies({ offline }) {
    let tree = verifyStDependencyTree();
    if (!tree.ok && !offline) {
        run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: ST_DIR });
        tree = verifyStDependencyTree();
    }
    if (!tree.ok) {
        throw new Error(`ST npm tree differs from its lock: ${[...tree.missing, ...tree.mismatched].slice(0, 3).join(', ')}. Run scripts/prepare-desktop-source.mjs`);
    }
    return tree;
}

export function verifyDesktopInputs({ prepare = false } = {}) {
    const lock = readJson(UPSTREAM_LOCK);
    verifyLockedCheckouts(lock, ['sillytavern', 'tavern-helper', 'ejs-template']);
    ensureLockedStDependencies({ offline: !prepare });
    return lock;
}

export function getHelperPackages() {
    const requireST = createRequire(path.join(ST_DIR, 'package.json'));
    const yaml = requireST('yaml');
    const lock = yaml.parse(fs.readFileSync(path.join(HELPER_DIR, 'pnpm-lock.yaml'), 'utf8'));
    return helperPackages.map(name => {
        const { dependencies, devDependencies } = lock.importers['.'];
        const requested = dependencies[name] ?? devDependencies[name];
        const version = requested.version.split('(')[0];
        const { integrity } = lock.packages[`${name}@${version}`].resolution;
        if (!integrity.startsWith('sha512-')) throw new Error(`Unsupported locked Helper integrity: ${name}`);
        return { name, version, integrity, archive: path.join(helperCache, `${name}-${version}.tgz`) };
    });
}

export function prepareHelperPackages({ offline = false } = {}) {
    const packages = getHelperPackages();
    if (!offline) {
        fs.mkdirSync(helperCache, { recursive: true });
        for (const file of fs.readdirSync(helperCache)) {
            if (!packages.some(pkg => path.basename(pkg.archive) === file)) fs.rmSync(path.join(helperCache, file));
        }
    }
    for (const pkg of packages) {
        const valid = () => fs.existsSync(pkg.archive) && `sha512-${sha512Base64(fs.readFileSync(pkg.archive))}` === pkg.integrity;
        if (!valid() && !offline) {
            run('npm', ['pack', `${pkg.name}@${pkg.version}`, '--ignore-scripts', '--pack-destination', helperCache]);
        }
        if (!valid()) throw new Error(`Missing or invalid locked Helper archive ${pkg.name}@${pkg.version}. Run scripts/prepare-desktop-source.mjs`);
    }
    return packages;
}

export function verifyDesktopVendorContract() {
    const vendor = readJson(VENDOR_LOCK);
    const available = new Set([
        ...vendor.packages.flatMap(pkg => pkg.files),
        ...vendor.local_sources,
    ].map(file => `${vendor.served_prefix}/${file.to}`));
    const patch = readJson(PATCH_SPEC);
    if (patch.served_prefix !== vendor.served_prefix) throw new Error('Desktop Helper vendor URL prefix differs from vendor.lock.json');
    for (const { to } of patch.replacements.filter(item => item.from.startsWith('https://testingcf.jsdelivr.net/'))) {
        if (!available.has(to)) throw new Error(`Helper asset URL is not locked: ${to}`);
    }
    return vendor;
}

export function prepareDesktopCheckouts() {
    const lock = readJson(UPSTREAM_LOCK);
    for (const item of lock.components) {
        const dir = components[item.id];
        if (fs.existsSync(dir)) continue;
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        try {
            run('git', ['init', '--quiet', dir]);
            run('git', ['-C', dir, 'fetch', '--quiet', '--depth=1', item.repo, item.commit]);
            run('git', ['-C', dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
        } catch (error) {
            fs.rmSync(dir, { recursive: true, force: true });
            throw error;
        }
    }
}
