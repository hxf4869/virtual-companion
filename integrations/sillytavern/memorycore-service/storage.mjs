import fs from 'node:fs';
import path from 'node:path';

export function privateDirectory(dir) {
    if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) {
        throw new Error('MEMORYCORE_UNSAFE_DIRECTORY');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    return dir;
}

export function prepareDataRoot(dataRoot) {
    privateDirectory(dataRoot);
    privateDirectory(path.join(dataRoot, 'owners'));
}

// Owner paths are derived from trusted positive decimal IDs, never request paths.
export function ownerDirectory(dataRoot, owner) {
    if (!/^[1-9][0-9]*$/.test(String(owner))) throw new Error('MEMORYCORE_INVALID_OWNER');
    prepareDataRoot(dataRoot);
    return privateDirectory(path.join(dataRoot, 'owners', String(owner)));
}
