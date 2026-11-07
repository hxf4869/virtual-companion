// CM experiments own only marked directories under .local. Only the typed
// synthetic answer API may retain generated dataset answers locally. No real
// conversation, prompt, secret, private endpoint or business ID belongs here.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { syntheticAnswerIdentity, assertSyntheticAnswerIdentity, validateSyntheticAnswer,
    validateSyntheticAnswers, syntheticAnswerKey, MAX_SYNTHETIC_RESPONSES } from './chat-memory-answers.mjs';

const MARKER = 'vc-chat-memory-round-v1';
const MAX_ROUNDS = 10, MAX_AGE_MS = 30 * 86400000, MAX_BYTES = 200 * 1024 * 1024;
const ROUND_BYTES = 10 * 1024 * 1024;
const FILES = new Set(['manifest.json', 'samples.jsonl', 'summary.json', 'comparison.md', 'budget.json']);
const ANSWERS_FILE = 'synthetic-answers.json';

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
        const stat = await fs.lstat(dir);
        if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
        if (!stat.isDirectory()) throw new Error('ARTIFACT_PATH_INVALID');
        if (!resume) throw new Error('ARTIFACT_ROUND_EXISTS');
        if ((await fs.lstat(path.join(dir, '.owner.json'))).isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
        marker = JSON.parse(await fs.readFile(path.join(dir, '.owner.json'), 'utf8'));
        if (marker.owner !== MARKER || !Number.isSafeInteger(marker.createdAt)) throw new Error('ARTIFACT_OWNER_INVALID');
        await treeSize(dir); // Refuse links before recovering known temporary files.
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
        for (const name of [...FILES, ANSWERS_FILE]) await fs.rm(path.join(dir, name + '.tmp'), { force: true });
        if (await treeSize(dir) > ROUND_BYTES) throw new Error('ARTIFACT_ROUND_CAPACITY');
    }
    await fs.chmod(dir, 0o700);
    await fs.chmod(path.join(dir, '.owner.json'), 0o600);
    let pending = Promise.resolve();
    const serialize = action => {
        const result = pending.then(action);
        pending = result.catch(() => {});
        return result;
    };
    const assertPrivateDirectories = async () => {
        for (const directory of [root, dir]) {
            const stat = await fs.lstat(directory);
            if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
            if (!stat.isDirectory()) throw new Error('ARTIFACT_PATH_INVALID');
            if ((stat.mode & 0o777) !== 0o700) throw new Error('ARTIFACT_PERMISSIONS');
        }
    };
    const readPrivateJson = async name => {
        await assertPrivateDirectories();
        const file = path.join(dir, name);
        let handle;
        try {
            handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error('ARTIFACT_PATH_INVALID');
            if ((stat.mode & 0o777) !== 0o600) throw new Error('ARTIFACT_PERMISSIONS');
            if (stat.size > ROUND_BYTES) throw new Error('ARTIFACT_ROUND_CAPACITY');
            const buffer = Buffer.alloc(stat.size + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > stat.size) throw new Error('ARTIFACT_ROUND_CAPACITY');
            try { return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
            catch { throw new Error('SYNTHETIC_ANSWERS_INVALID'); }
        } catch (error) {
            if (error.code === 'ELOOP') throw new Error('ARTIFACT_SYMLINK');
            throw error;
        } finally { await handle?.close(); }
    };
    const writeAtomic = async (name, content) => {
        await assertPrivateDirectories();
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
        const target = path.join(dir, name);
        let previous = 0;
        try {
            const stat = await fs.lstat(target);
            if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
            if (!stat.isFile()) throw new Error('ARTIFACT_PATH_INVALID');
            previous = stat.size;
        }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if ((await treeSize(dir)) - previous + Buffer.byteLength(text) > ROUND_BYTES) throw new Error('ARTIFACT_ROUND_CAPACITY');
        await fs.writeFile(target + '.tmp', text, { mode: 0o600, flag: 'wx' });
        await fs.rename(target + '.tmp', target);
    };
    const checkedIdentity = async options => {
        const identity = syntheticAnswerIdentity(options);
        if (identity.round !== round) throw new Error('SYNTHETIC_ANSWERS_IDENTITY');
        let manifest;
        try { manifest = await readPrivateJson('manifest.json'); }
        catch (error) { if (error.code === 'ENOENT') throw new Error('SYNTHETIC_ANSWERS_IDENTITY'); throw error; }
        assertSyntheticAnswerIdentity(manifest, identity);
        return identity;
    };
    const readAnswers = async identity => {
        try { return validateSyntheticAnswers(await readPrivateJson(ANSWERS_FILE), identity); }
        catch (error) { if (error.code === 'ENOENT') throw new Error('SYNTHETIC_ANSWERS_MISSING'); throw error; }
    };
    return { dir,
        write: (name, content) => serialize(() => {
            if (!FILES.has(name)) throw new Error('ARTIFACT_NAME_INVALID');
            return writeAtomic(name, content);
        }),
        readSyntheticAnswers: options => serialize(async () => readAnswers(await checkedIdentity(options))),
        saveSyntheticAnswer: (options, response) => {
            // Copy before queueing so callers cannot change a pending checkpoint.
            let identity, answer;
            try { identity = syntheticAnswerIdentity(options); answer = validateSyntheticAnswer(response); }
            catch (error) { return Promise.reject(error); }
            return serialize(async () => {
                await checkedIdentity(identity);
                let document;
                try { document = await readAnswers(identity); }
                catch (error) {
                    if (error.message !== 'SYNTHETIC_ANSWERS_MISSING') throw error;
                    document = { schemaVersion: 1, ...identity, responses: [] };
                }
                if (document.responses.some(row => syntheticAnswerKey(row) === syntheticAnswerKey(answer))) throw new Error('SYNTHETIC_ANSWER_DUPLICATE');
                if (document.responses.length >= MAX_SYNTHETIC_RESPONSES) throw new Error('SYNTHETIC_ANSWERS_LIMIT');
                document.responses.push(answer);
                await writeAtomic(ANSWERS_FILE, document);
            });
        },
        close: () => serialize(async () => {
        await assertPrivateDirectories();
        await fs.writeFile(path.join(dir, '.owner.json'), JSON.stringify({ ...marker, closed: true }), { mode: 0o600 });
    }) };
}
