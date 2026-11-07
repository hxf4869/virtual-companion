// CM experiments own only marked directories under .local. No body, prompt,
// secret, private endpoint or stable business identifier belongs in these files.
import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER = 'vc-chat-memory-round-v1';
const MAX_ROUNDS = 10, MAX_AGE_MS = 30 * 86400000, MAX_BYTES = 200 * 1024 * 1024;
const ROUND_BYTES = 10 * 1024 * 1024;
const FILES = new Set(['manifest.json', 'samples.jsonl', 'summary.json', 'comparison.md', 'budget.json']);

async function treeSize(root) {
    let bytes = 0;
    const fileSizes = new Map();
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) bytes += await treeSize(file);
        else {
            try { fileSizes.set(entry.name, (await fs.stat(file)).size); }
            catch (error) {
                // The budget writer atomically renames its private temporary
                // journal while checkpoints measure retained artifact size.
                if (error.code !== 'ENOENT' || !/^budget\.json\.[a-f0-9]{16}\.tmp$/.test(entry.name)) throw error;
                // Replace any earlier observation of the committed journal:
                // ignoring the vanished temp alone could undercount its growth.
                fileSizes.set('budget.json', (await fs.stat(path.join(root, 'budget.json'))).size);
            }
        }
    }
    return bytes + [...fileSizes.values()].reduce((sum, size) => sum + size, 0);
}

async function ownedRounds(root) {
    const rounds = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^round-[a-z0-9-]+$/.test(entry.name)) continue;
        const dir = path.join(root, entry.name);
        const markerPath = path.join(dir, '.owner.json');
        try {
            if ((await fs.lstat(markerPath)).isSymbolicLink()) continue;
            const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
            if (marker.owner !== MARKER || !Number.isSafeInteger(marker.createdAt)) continue;
            rounds.push({ dir, marker, bytes: await treeSize(dir) });
        } catch (error) { if (error.message === 'ARTIFACT_SYMLINK') throw error; }
    }
    return rounds.sort((a, b) => a.marker.createdAt - b.marker.createdAt);
}

export async function createRoundArtifacts(root, { round, now = Date.now(), resume = false } = {}) {
    if (!/^round-[a-z0-9-]{1,80}$/.test(round || '')) throw new Error('ARTIFACT_ROUND_INVALID');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    await fs.chmod(root, 0o700);
    const dir = path.join(root, round);
    let marker;
    try {
        if (!(await fs.lstat(dir)).isDirectory()) throw new Error('ARTIFACT_PATH_INVALID');
        if (!resume) throw new Error('ARTIFACT_ROUND_EXISTS');
        if ((await fs.lstat(path.join(dir, '.owner.json'))).isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
        marker = JSON.parse(await fs.readFile(path.join(dir, '.owner.json'), 'utf8'));
        if (marker.owner !== MARKER || !Number.isSafeInteger(marker.createdAt)) throw new Error('ARTIFACT_OWNER_INVALID');
        if (await treeSize(dir) > ROUND_BYTES) throw new Error('ARTIFACT_ROUND_CAPACITY');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (resume) throw new Error('ARTIFACT_RESUME_MISSING');
    }
    if (!resume) {
    let rounds = await ownedRounds(root);
    const evict = async row => { await fs.rm(row.dir, { recursive: true }); rounds = rounds.filter(item => item !== row); };
    for (const row of [...rounds]) if (row.marker.closed && now - row.marker.createdAt > MAX_AGE_MS) await evict(row);
    while (rounds.length >= MAX_ROUNDS || (await treeSize(root)) + ROUND_BYTES > MAX_BYTES) {
        const old = rounds.find(row => row.marker.closed);
        if (!old) throw new Error('ARTIFACT_CAPACITY');
        await evict(old);
    }
    await fs.mkdir(dir, { mode: 0o700 }); // Never reset an existing round / budget.
    marker = { owner: MARKER, createdAt: now, closed: false };
    await fs.writeFile(path.join(dir, '.owner.json'), JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
    } else {
        // The real runner acquires its existing budget lock before resuming.
        marker.closed = false;
        await fs.writeFile(path.join(dir, '.owner.json'), JSON.stringify(marker), { mode: 0o600 });
        for (const name of FILES) await fs.rm(path.join(dir, name + '.tmp'), { force: true });
    }
    const write = async (name, content) => {
        if (!FILES.has(name)) throw new Error('ARTIFACT_NAME_INVALID');
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
        const target = path.join(dir, name);
        let previous = 0;
        try { const stat = await fs.lstat(target); if (!stat.isFile()) throw new Error('ARTIFACT_PATH_INVALID'); previous = stat.size; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if ((await treeSize(dir)) - previous + Buffer.byteLength(text) > ROUND_BYTES) throw new Error('ARTIFACT_ROUND_CAPACITY');
        await fs.writeFile(target + '.tmp', text, { mode: 0o600, flag: 'wx' });
        await fs.rename(target + '.tmp', target);
    };
    return { dir, write, async close() {
        await fs.writeFile(path.join(dir, '.owner.json'), JSON.stringify({ ...marker, closed: true }), { mode: 0o600 });
    } };
}
