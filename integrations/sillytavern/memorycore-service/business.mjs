import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ownerDirectory, privateDirectory } from './storage.mjs';

const fail = code => { throw new Error(`MEMORYCORE_${code}`); };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
export function mapScope(scope) {
    if (!scope || !/^[1-9][0-9]*$/.test(scope.ownerId) || !/^[1-9][0-9]*$/.test(scope.instanceId) ||
        !['COMPANION', 'STORY'].includes(scope.mode) || !safeId(scope.domainId) || !safeId(scope.profileScopeId)) fail('SCOPE');
    return { teamId: `owner:${scope.ownerId}`, userId: `owner:${scope.ownerId}`, agentId: `instance:${scope.instanceId}:mode:${scope.mode}`,
        sessionId: scope.domainId, sessionKey: scope.domainId };
}
function scopeKey(scope) { return `${scope.instanceId}:${scope.mode}:${scope.domainId}:${scope.profileScopeId}`; }
function sameIdentity(a, b) { return JSON.stringify(mapScope(a)) === JSON.stringify(mapScope(b)); }
function sameScope(a, b) { return sameIdentity(a, b) && a.profileScopeId === b.profileScopeId; }
async function readJSON(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function writeJSON(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, file); }
    finally { await fs.rm(tmp, { force: true }); }
}
async function entries(dir) { try { return await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
function allowed(input) {
    if (!Array.isArray(input.allowedRecordIds) || input.allowedRecordIds.length > 100000 || !input.allowedRecordIds.every(safeId)) fail('ALLOWLIST');
    return [...new Set(input.allowedRecordIds)];
}

// Authenticated Go is the only caller. All identities and allowlists are supplied
// outside model output; filesystem paths and callback URLs are never request fields.
export function createControlledEngine({ dataRoot, nativeFactory, embeddingFactory, runnerFactory, publishHook = async () => {} }) {
    const owners = new Map(), pending = new Map(), queues = new Map();
    async function owner(scope) {
        mapScope(scope);
        if (!owners.has(scope.ownerId)) owners.set(scope.ownerId, (async () => {
            const dir = ownerDirectory(dataRoot, scope.ownerId);
            for (const sub of ['operations', 'records', 'profiles', 'staging']) privateDirectory(path.join(dir, sub));
            return { dir, native: await nativeFactory(dir) };
        })());
        return owners.get(scope.ownerId);
    }
    async function serial(key, action) {
        const before = queues.get(key) || Promise.resolve();
        const next = before.catch(() => {}).then(action); queues.set(key, next);
        try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
    }
    function checkRevision(native, scope, revision) {
        if (!Number.isSafeInteger(revision) || revision < 0 || native.getScope(scopeKey(scope)).revision !== revision) fail('REVISION_CONFLICT');
    }
    function spaceFile(ctx) { return path.join(ctx.dir, 'space-config.json'); }
    async function configure(ctx, config) {
        const next = structuredClone(config);
        if (!next?.spaceId || !Number.isInteger(next.dimensions) || !Number.isSafeInteger(next.revision) || next.revision < 1) fail('SPACE_CONFIG');
        // Separate short queue: owner operations may enter this queue, but it
        // never acquires the owner queue or waits for a model/embedding call.
        return serial(spaceFile(ctx), async () => {
            const saved = await readJSON(spaceFile(ctx));
            if (saved) {
                if (next.revision < saved.revision) fail('SPACE_CONFIG_REVISION');
                if (next.revision === saved.revision && !isDeepStrictEqual(next, saved)) fail('SPACE_CONFIG_CONFLICT');
                const { revision: _newRevision, state: _newState, ...newSpace } = next;
                const { revision: _oldRevision, state: _oldState, ...oldSpace } = saved;
                if (next.spaceId === saved.spaceId && !isDeepStrictEqual(newSpace, oldSpace)) fail('SPACE_CONFIG_CONFLICT');
            }
            // Persist the fence before changing native vectors. A failure keeps
            // the newer snapshot authoritative and allows only its own retry.
            if (!isDeepStrictEqual(next, saved)) await writeJSON(spaceFile(ctx), next);
            ctx.native.configureSpace(next.spaceId, next.dimensions);
        });
    }
    async function currentSpace(ctx, config, action) {
        return serial(spaceFile(ctx), async () => {
            const saved = await readJSON(spaceFile(ctx));
            if (!saved || saved.revision !== config.revision) fail('SPACE_CONFIG_REVISION');
            if (!isDeepStrictEqual(saved, config)) fail('SPACE_CONFIG_CONFLICT');
            if (ctx.native.getSpace()?.spaceId !== config.spaceId) fail('SPACE_CONFLICT');
            return action();
        });
    }
    async function operation(ctx, input) {
        if (!safeId(input.operationId)) fail('OPERATION_ID');
        const file = path.join(ctx.dir, 'operations', `${input.operationId}.json`);
        const stored = await readJSON(file);
        if (stored && !sameScope(stored.scope, input.scope)) fail('OPERATION_SCOPE');
        return { file, stored };
    }
    async function operationEntries(ctx) {
        const out = [];
        for (const name of await entries(path.join(ctx.dir, 'operations'))) {
            if (!name.endsWith('.json')) continue;
            const file = path.join(ctx.dir, 'operations', name), op = await readJSON(file);
            if (op) out.push({ file, id: name.slice(0, -5), op });
        }
        return out;
    }
    async function noCleanup(ctx) { if (await readJSON(path.join(ctx.dir, 'cleanup.json'))) fail('CLEANUP_PENDING'); }
    async function liveOperation(ctx, file, scope, revision, status) {
        checkRevision(ctx.native, scope, revision);
        if ((await readJSON(file))?.status !== status) fail('REVISION_CONFLICT');
    }
    async function scrubOperation(ctx, id, op, removed, revokeAll = false) {
        const file = path.join(ctx.dir, 'operations', id + '.json'), shard = path.join(ctx.dir, 'records', id + '.jsonl');
        await fs.rm(path.join(ctx.dir, 'profiles', id), { recursive: true, force: true });
        await fs.rm(path.join(ctx.dir, 'staging', id), { recursive: true, force: true });
        const retained = (op.proposal?.records || []).filter(r => !removed.has(r.id));
        if (!revokeAll && retained.length && op.status === 'published') {
            const temp = shard + '.tmp';
            await fs.writeFile(temp, retained.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 }); await fs.rename(temp, shard);
            await writeJSON(file, { scope: op.scope, status: 'published', receipt: { ...op.receipt, recordIds: retained.map(r => r.id) }, proposal: { records: retained } });
        } else {
            await fs.rm(shard, { force: true });
            await writeJSON(file, { scope: op.scope, status: 'revoked' });
        }
    }
    async function scrubSuperseded(ctx, currentId, targets, sourceDependencies) {
        if (!targets.length) return;
        const removed = new Set(targets.map(t => t.id));
        const ops = await operationEntries(ctx), dependencies = new Set(sourceDependencies || []);
        for (const { op } of ops) for (const record of op.proposal?.records || [])
            if (removed.has(record.id)) for (const id of record.metadata?.vcDependencies || []) dependencies.add(id);
        for (const { id, op } of ops) if (id !== currentId && (op.proposal?.records?.some(r => removed.has(r.id)) || op.dependencies?.some(id => dependencies.has(id))))
            await scrubOperation(ctx, id, op, removed, Boolean(op.dependencies));
    }
    async function runCleanup(ctx, cleanup, file) {
        const { native } = ctx, { request } = cleanup;
        try {
            for (const scope of cleanup.scopes) {
                const revision = native.getScope(scope.key).revision;
                if (revision === scope.revision - 1) native.invalidateScope(scope.key);
                else if (revision !== scope.revision) fail('REVISION_CONFLICT');
            }
            native.forgetRecords(cleanup.removed, request.action === 'forget' ? mapScope(request.scope) : undefined);
            const retainedSources = new Set(native.list().flatMap(r => r.metadata?.vcDependencies || []));
            native.forgetSources(cleanup.sourceIds.filter(id => !retainedSources.has(id)), request.action === 'forget' ? mapScope(request.scope) : undefined);
            for (const { id } of cleanup.operations) {
                const op = await readJSON(path.join(ctx.dir, 'operations', id + '.json'));
                if (op) await scrubOperation(ctx, id, op, new Set(cleanup.removed), request.action === 'clear-owner');
            }
            // An outstanding model tool can still recreate its staging directory.
            // Keep the cleanup intent until that bounded task has ended.
            if (cleanup.operations.some(({ id }) => pending.has(path.join(ctx.dir, 'operations', id + '.json'))))
                return { status: 'pending', revision: native.getScope(scopeKey(request.scope)).revision, removed: cleanup.removed.length, physicalErasure: false };
            await fs.rm(file, { force: true });
            return { status: 'cleared', revision: native.getScope(scopeKey(request.scope)).revision, removed: cleanup.removed.length, physicalErasure: false };
        } catch {
            return { status: 'pending', revision: native.getScope(scopeKey(request.scope)).revision, removed: cleanup.removed.length, physicalErasure: false };
        }
    }
    async function profileFiles(dir, prefix = '') {
        const result = {};
        for (const name of await entries(path.join(dir, prefix))) {
            const rel = path.join(prefix, name), stat = await fs.lstat(path.join(dir, rel));
            if (stat.isSymbolicLink()) fail('PROFILE_PATH');
            if (stat.isDirectory()) Object.assign(result, await profileFiles(dir, rel));
            else if (stat.isFile()) result[rel] = await fs.readFile(path.join(dir, rel), 'utf8');
        }
        return result;
    }
    async function invoke(action, input) {
        if (!input || typeof input !== 'object' || ['owner','directory','dataRoot','callbackURL','callbackUrl'].some(k => Object.hasOwn(input, k))) fail('REQUEST');
        const ctx = await owner(input.scope), { native, dir } = ctx;
        const key = scopeKey(input.scope), mapped = mapScope(input.scope);
        if (action === 'propose') {
            const ids = allowed(input);
            if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 100 ||
                input.messages.some(m => !safeId(m.id) || typeof m.content !== 'string' || m.content.length > 100000 || !Number.isFinite(Date.parse(m.timestamp)))) fail('MESSAGES');
            const request = { scope: input.scope, revision: input.revision, embedding: input.embedding, allowedRecordIds: ids, messages: input.messages };
            // Reserve under the owner lock, but never hold it while calling a model.
            // Returning a task container avoids promise adoption by serial().
            const slot = await serial(input.scope.ownerId, async () => {
                await noCleanup(ctx); checkRevision(native, input.scope, input.revision);
                await configure(ctx, input.embedding);
                const { file, stored } = await operation(ctx, input);
                if (stored) {
                    if (JSON.stringify(stored.request) !== JSON.stringify(request)) fail('OPERATION_CONFLICT');
                    if (stored.status === 'proposed') return { work: Promise.resolve(stored.proposal) };
                    if (stored.status === 'preparing' && pending.has(file)) return { work: pending.get(file) };
                    fail('OPERATION_NOT_PROPOSABLE');
                }
                await writeJSON(file, { scope: input.scope, request, status: 'preparing' });
                const work = (async () => {
                    try {
                        const embedding = await embeddingFactory(input.embedding);
                        const proposal = await native.prepare({ messages: input.messages, scope: mapped, allowedRecordIds: ids,
                            runner: runnerFactory(input.operationToken), embedding, recordedAt: input.messages.at(-1).timestamp });
                        const targets = proposal.targets || [];
                        if (targets.some(t => !ids.includes(t.id))) fail('TARGET_NOT_ALLOWED');
                        const existing = native.list(ids, mapped);
                        const dependencies = [...new Set([...input.messages.map(m => m.id), ...existing.filter(r => targets.some(t => t.id === r.id)).flatMap(r => r.metadata?.vcDependencies || [])])];
                        for (const record of proposal.records) {
                            if (!safeId(record.id)) fail('RECORD_ID');
                            Object.assign(record, mapped);
                            record.source_message_ids = [...dependencies];
                            record.metadata = { ...record.metadata, vcDependencies: dependencies, vcScopeKey: key };
                        }
                        const vectors = await embedding.embedBatch(proposal.records.map(r => r.content));
                        proposal.vectors = vectors.map(v => [...v]); proposal.dependencies = dependencies;
                        return await serial(input.scope.ownerId, async () => {
                            await liveOperation(ctx, file, input.scope, input.revision, 'preparing');
                            return currentSpace(ctx, input.embedding, async () => {
                                await writeJSON(file, { scope: input.scope, request, status: 'proposed', proposal });
                                return proposal;
                            });
                        });
                    } catch (e) {
                        await serial(input.scope.ownerId, async () => {
                            const current = await readJSON(file);
                            if (current?.status === 'preparing' && native.getScope(key).revision === input.revision)
                                await writeJSON(file, { scope: input.scope, request, status: 'failed' });
                        });
                        throw e;
                    } finally { pending.delete(file); }
                })();
                pending.set(file, work); return { work };
            });
            return slot.work;
        }
        if (action === 'commit') return serial(input.scope.ownerId, async () => {
            await noCleanup(ctx); checkRevision(native, input.scope, input.revision);
            const { file, stored } = await operation(ctx, input);
            if (!stored || !['proposed','publishing','published'].includes(stored.status)) fail('PROPOSAL_REQUIRED');
            if (stored.request?.revision !== input.revision) fail('REVISION_CONFLICT');
            return currentSpace(ctx, stored.request.embedding, async () => {
                if (stored.status === 'published') return stored.receipt;
                const p = stored.proposal;
                const receipt = native.commitPrepared({ operationId: input.operationId, scopeKey: key, revision: input.revision,
                    spaceId: stored.request.embedding.spaceId, filter: mapped,
                    l0Records: stored.request.messages.map(m => ({ id: m.id, ...mapped, role: m.role || 'user', messageText: m.content,
                        recordedAt: m.timestamp, timestamp: Date.parse(m.timestamp) })), records: p.records.map((record, i) => ({ record, embedding: Float32Array.from(p.vectors[i]) })), targets: p.targets });
                if (receipt.status === 'revoked') fail('REVISION_CONFLICT');
                stored.status = 'publishing'; stored.receipt = receipt; await writeJSON(file, stored);
                await scrubSuperseded(ctx, input.operationId, p.targets || [], p.dependencies);
                await publishHook();
                // One recoverable JSONL shard per operation. Replaying rewrites the same
                // shard, never repeats extraction or appends duplicate records.
                const recordFile = path.join(dir, 'records', `${input.operationId}.jsonl`);
                const temp = recordFile + '.tmp';
                await fs.writeFile(temp, p.records.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
                await fs.rename(temp, recordFile);
                stored.receipt = { ...receipt, status: 'published' }; stored.status = 'published';
                await writeJSON(file, stored); return stored.receipt;
            });
        });
        if (action === 'operation-status') {
            const { stored } = await operation(ctx, input);
            if (!stored) return { status: 'unknown' };
            const revoked = native.getOperation(input.operationId)?.status === 'revoked';
            return revoked ? { status: 'revoked' } : { status: stored.status, ...(stored.receipt ? { receipt: stored.receipt } : {}) };
        }
        if (action === 'search') {
            if (await readJSON(path.join(dir, 'cleanup.json'))) return [];
            const revision = native.getScope(key).revision;
            const ids = allowed(input); if (!ids.length) return [];
            await configure(ctx, input.embedding);
            const published = new Set();
            for (const { op } of await operationEntries(ctx)) {
                if (op?.status === 'published' && sameIdentity(op.scope, input.scope)) for (const id of op.receipt.recordIds) published.add(id);
            }
            const eligible = ids.filter(id => published.has(id)); if (!eligible.length) return [];
            const embedding = native.getSpace().rebuilding ? undefined : await embeddingFactory(input.embedding);
            const results = await native.search({ query: input.query, topK: Math.min(input.topK || 5, 50), scope: mapped,
                allowedRecordIds: eligible, embedding, eventDate: input.eventDate });
            return currentSpace(ctx, input.embedding, async () =>
                !(await readJSON(path.join(dir, 'cleanup.json'))) && native.getScope(key).revision === revision ? results : []);
        }
        if (action === 'rebuild-space') return serial(input.scope.ownerId, async () => {
            await noCleanup(ctx);
            await configure(ctx, input.embedding);
            const embedding = await embeddingFactory(input.embedding);
            let failures = 0;
            for (const record of native.list()) {
                try {
                    const vector = await embedding.embed(record.content);
                    await currentSpace(ctx, input.embedding, () => native.rebuildVector(record, vector, input.embedding.spaceId));
                }
                catch { failures++; }
            }
            await currentSpace(ctx, input.embedding, () => native.finishSpaceRebuild(input.embedding.spaceId, failures));
            return { spaceId: input.embedding.spaceId, failures, ready: failures === 0 };
        });
        if (action === 'rebuild-profile') {
            const ids = allowed(input);
            if (input.publish === true) return serial(input.scope.ownerId, async () => {
                await noCleanup(ctx); checkRevision(native, input.scope, input.revision);
                const { file, stored } = await operation(ctx, input);
                if (!stored || !['staged','profile-publishing','profile-published'].includes(stored.status) || stored.revision !== input.revision ||
                    !Array.isArray(input.verifiedDependencies) || stored.dependencies.some(id => !input.verifiedDependencies.includes(id))) fail('PROFILE_VERIFICATION');
                const destination = path.join(dir, 'profiles', input.operationId);
                if (stored.status !== 'profile-published') {
                    await writeJSON(file, { ...stored, status: 'profile-publishing' });
                    try { await fs.rename(path.join(dir, 'staging', input.operationId), destination); }
                    catch (e) { if (e.code !== 'ENOENT') throw e; await fs.access(destination); }
                    await writeJSON(file, { ...stored, status: 'profile-published' });
                }
                return { status: 'published', dependencies: stored.dependencies };
            });
            const slot = await serial(input.scope.ownerId, async () => {
                await noCleanup(ctx); checkRevision(native, input.scope, input.revision);
                const { file, stored } = await operation(ctx, input);
                if (stored) fail('OPERATION_CONFLICT');
                const records = native.list(ids, mapped);
                if (ids.some(id => !records.some(record => record.id === id)) || records.some(record =>
                    !Array.isArray(record.metadata?.vcDependencies) || !record.metadata.vcDependencies.length || !record.metadata.vcDependencies.every(safeId))) fail('PROFILE_INPUT');
                const dependencies = [...new Set(records.flatMap(r => r.metadata?.vcDependencies || []))];
                const stagingDir = path.join(dir, 'staging', input.operationId); privateDirectory(stagingDir);
                await writeJSON(file, { scope: input.scope, status: 'building-profile', revision: input.revision, dependencies });
                const work = (async () => {
                    try {
                        await native.rebuildProfile({ records, stagingDir, scope: mapped, runner: runnerFactory(input.operationToken, stagingDir) });
                        return await serial(input.scope.ownerId, async () => {
                            await liveOperation(ctx, file, input.scope, input.revision, 'building-profile');
                            await writeJSON(file, { scope: input.scope, status: 'staged', revision: input.revision, dependencies });
                            return { status: 'staged', dependencies };
                        });
                    } catch (error) {
                        await serial(input.scope.ownerId, async () => {
                            await fs.rm(stagingDir, { recursive: true, force: true });
                            const current = await readJSON(file);
                            if (current?.status === 'building-profile' && native.getScope(key).revision === input.revision)
                                await writeJSON(file, { scope: input.scope, status: 'failed' });
                        });
                        throw error;
                    } finally { pending.delete(file); }
                })();
                pending.set(file, work); return { work };
            });
            return slot.work;
        }
        if (['forget','clear-owner'].includes(action)) return serial(input.scope.ownerId, async () => {
            if (action === 'forget' && (!Array.isArray(input.recordIds) || !input.recordIds.every(safeId))) fail('RECORD_IDS');
            const file = path.join(dir, 'cleanup.json');
            const request = { action, scope: input.scope, revision: input.revision, recordIds: [...new Set(input.recordIds || [])].sort() };
            let cleanup = await readJSON(file);
            if (cleanup) {
                if (JSON.stringify(cleanup.request) !== JSON.stringify(request)) fail('CLEANUP_PENDING');
            } else {
                checkRevision(native, input.scope, input.revision);
                const selected = native.list(action === 'forget' ? input.recordIds : undefined, action === 'forget' ? mapped : undefined);
                const removed = selected.map(r => r.id), dependencies = new Set(selected.flatMap(r => r.metadata?.vcDependencies || []));
                const ops = (await operationEntries(ctx)).filter(({ op }) => action === 'clear-owner' || sameScope(op.scope, input.scope) ||
                    op.proposal?.records?.some(r => removed.includes(r.id)) || op.dependencies?.some(id => dependencies.has(id)));
                const keys = new Set([key, ...selected.map(r => r.metadata?.vcScopeKey).filter(Boolean), ...ops.map(({ op }) => scopeKey(op.scope))]);
                const sourceIds = action === 'clear-owner' ? native.listSources().map(r => r.id || r.record_id) : [...dependencies];
                cleanup = { request, status: 'pending', removed, sourceIds, scopes: [...keys].map(key => ({ key, revision: native.getScope(key).revision + 1 })),
                    operations: ops.map(({ id, op }) => ({ id, scope: op.scope })) };
                await writeJSON(file, cleanup); // Durable, body-free intent precedes invalidation/deletion.
            }
            return runCleanup(ctx, cleanup, file);
        });
        if (action === 'export-owner') return serial(input.scope.ownerId, async () => {
            const profiles = [], jsonl = [], operations = [];
            for (const { id, op } of await operationEntries(ctx)) {
                operations.push({ operationId: id, scope: op.scope, status: op.status, ...(op.receipt ? { receipt: op.receipt } : {}) });
                if (op.status === 'profile-published') profiles.push({ operationId: id, scope: op.scope, dependencies: op.dependencies,
                    files: await profileFiles(path.join(dir, 'profiles', id)) });
                if (op.status === 'published') {
                    const shard = path.join(dir, 'records', id + '.jsonl');
                    try { jsonl.push({ operationId: id, content: await fs.readFile(shard, 'utf8') }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
                }
            }
            return { records: native.list(), sources: native.listSources(), profiles, jsonl, operations,
                embeddingSpace: native.getSpace(), cleanup: (await readJSON(path.join(dir, 'cleanup.json')))?.status || 'clear', physicalErasure: false };
        });
        fail('NOT_FOUND');
    }
    return { invoke, async ready() { return true; }, async close() { for (const p of owners.values()) (await p).native.close(); } };
}
