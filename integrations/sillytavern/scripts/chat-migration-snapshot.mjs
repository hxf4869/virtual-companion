// SPDX-License-Identifier: AGPL-3.0-only
// Local operator subprocess. stdin is the authenticated Go CLI boundary; never expose as HTTP.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sourceMessages } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { loadConfig } from '../server-plugin/virtual-companion/lib/config.js';
import { fail, checkAbort, relativePath, safeRoot, safePath, readJSON, writePrivate, inspectJSONL, isolatedDirectory } from './lib/chat-migration-files.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireValue = (ok, code) => { if (!ok) throw fail(code); };
const decimal = (v, positive = false) => typeof v === 'string' && DECIMAL.test(v) && (!positive || BigInt(v) > 0n);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameInstant = (a, b) => a == null && b == null || typeof a === 'string' && typeof b === 'string'
    && /(Z|[+-]\d{2}:\d{2})$/.test(a) && /(Z|[+-]\d{2}:\d{2})$/.test(b) && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
function context(options) {
    requireValue(UUID.test(options.migrationRunId || '') && decimal(options.ownerAccountId, true) && decimal(options.frozenAuthorityEpoch, true));
    return { ownerAccountId: options.ownerAccountId, migrationRunId: options.migrationRunId, frozenAuthorityEpoch: options.frozenAuthorityEpoch };
}
function matchesContext(manifest, options, direction) {
    requireValue(manifest?.formatVersion === 1 && manifest.direction === direction && Object.entries(context(options)).every(([k, v]) => manifest[k] === v));
    requireValue(Array.isArray(manifest.chats) && Array.isArray(manifest.deletionAndSuppressionRecords));
}
function filename(value) {
    relativePath(value);
    requireValue(!value.includes('/') && value.endsWith('.jsonl'), 'CHAT_MIGRATION_PATH_INVALID');
    return value;
}
function scopePath(chat, characterDirectories) {
    const name = filename(chat.primaryFileName);
    if (chat.kind === 'SINGLE') {
        relativePath(chat.characterRef);
        requireValue(!chat.characterRef.includes('/') && !chat.groupRef);
        const directory = characterDirectories?.[chat.characterRef];
        relativePath(directory);
        requireValue(!directory.includes('/'), 'CHAT_MIGRATION_RESOURCE_MAPPING_REQUIRED');
        return `chats/${directory}/${name}`;
    }
    requireValue(chat.kind === 'GROUP' && typeof chat.groupRef === 'string' && chat.groupRef && !chat.characterRef);
    return `group chats/${name}`;
}
function validateChat(chat) {
    requireValue(UUID.test(chat?.oldIdentity || '') && UUID.test(chat.branchRoot || '') && ['live', 'deleted'].includes(chat.state));
    for (const field of ['chatRevision', 'metadataRevision', 'orderRevision']) requireValue(decimal(chat[field], true));
    requireValue(Array.isArray(chat.aliases) && Array.isArray(chat.messageAndCandidateIdentityRecords) && Array.isArray(chat.sourceRecords));
    filename(chat.primaryFileName);
    requireValue(chat.kind === 'SINGLE' ? typeof chat.characterRef === 'string' && chat.characterRef && !chat.groupRef
        : chat.kind === 'GROUP' && typeof chat.groupRef === 'string' && chat.groupRef && !chat.characterRef);
    chat.aliases.forEach(filename);
    requireValue(new Set(chat.aliases).size === chat.aliases.length);
    for (const field of ['conversationId', 'relationshipId']) requireValue(chat[field] === null || decimal(chat[field], true));
    requireValue((chat.conversationId === null) === (chat.relationshipId === null));
    const ids = new Set(), sourceKeys = new Set(), identities = new Map();
    for (const message of chat.messageAndCandidateIdentityRecords) {
        requireValue(UUID.test(message.messageId || '') && !ids.has(message.messageId) && decimal(message.messageRevision, true) && decimal(message.position) && typeof message.deleted === 'boolean' && Array.isArray(message.candidates));
        ids.add(message.messageId);
        const ordinals = new Set();
        for (const candidate of message.candidates) {
            requireValue(UUID.test(candidate.candidateId || '') && !ids.has(candidate.candidateId) && Number.isSafeInteger(candidate.ordinal) && candidate.ordinal >= 0 && !ordinals.has(candidate.ordinal));
            requireValue(decimal(candidate.sourceRevision, true) && decimal(candidate.sourceGeneration, true) && ['deleted', 'settled', 'everSelected'].every((k) => typeof candidate[k] === 'boolean'));
            requireValue(!message.deleted || candidate.deleted);
            ids.add(candidate.candidateId); ordinals.add(candidate.ordinal);
            identities.set(`${message.messageId}/${candidate.candidateId}`, candidate);
        }
        requireValue(message.deleted || message.candidates.some((c) => c.candidateId === message.selectedCandidateId && !c.deleted && c.everSelected));
    }
    for (const source of chat.sourceRecords) {
        requireValue(object(source) && !['UNKNOWN', 'UNAVAILABLE'].includes(source.state), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        const key = `${source.messageId}/${source.candidateId}`;
        requireValue(!sourceKeys.has(key), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        sourceKeys.add(key);
        const candidate = identities.get(key);
        requireValue(candidate && candidate.sourceRevision === source.sourceRevision && candidate.sourceGeneration === source.sourceGeneration && candidate.settled === source.settled, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        requireValue(['present', 'eligible', 'suppressed'].every((k) => typeof source[k] === 'boolean') && decimal(source.appliedRevision) && source.branchRoot === chat.branchRoot && source.conversationId === chat.conversationId, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        requireValue(!candidate.deleted || !source.present, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
    }
    // Every identity, including an absent/deleted candidate, needs a verifiable rights row.
    for (const message of chat.messageAndCandidateIdentityRecords) for (const candidate of message.candidates) requireValue(sourceKeys.has(`${message.messageId}/${candidate.candidateId}`), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
    requireValue(chat.state !== 'deleted' || chat.messageAndCandidateIdentityRecords.every((m) => m.deleted));
}

// The supplement already unions the frozen PG/external domains. A restored ST
// root can carry an additional, older rights floor, which must never be cleared.
function mergeRights(manifest, additional = []) {
    const chats = new Map(manifest.chats.map((chat) => [chat.oldIdentity, chat]));
    const messages = new Map(), candidates = new Map(), sources = new Map(), merged = new Map();
    for (const chat of manifest.chats) {
        for (const message of chat.messageAndCandidateIdentityRecords) {
            messages.set(`${chat.oldIdentity}/${message.messageId}`, message);
            for (const candidate of message.candidates) candidates.set(`${chat.oldIdentity}/${message.messageId}/${candidate.candidateId}`, candidate);
        }
        for (const source of chat.sourceRecords) sources.set(`${chat.oldIdentity}/${source.messageId}/${source.candidateId}`, source);
    }
    for (const input of [...manifest.deletionAndSuppressionRecords, ...additional]) {
        requireValue(object(input) && ['chat', 'message', 'candidate', 'source', 'inbox'].includes(input.type), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        const chat = chats.get(input.chatId);
        requireValue(chat, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        const key = input.type === 'inbox' ? `inbox/${input.eventId}` : `${input.type}/${input.chatId}/${input.messageId || ''}/${input.candidateId || ''}`;
        const previous = merged.get(key);
        let record = { ...input };
        if (input.type === 'source') {
            const source = sources.get(`${input.chatId}/${input.messageId}/${input.candidateId}`);
            requireValue(source && typeof input.suppressed === 'boolean' && typeof input.present === 'boolean' && decimal(input.sourceRevision, true) && decimal(input.sourceGeneration, true), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
            source.suppressed ||= input.suppressed || previous?.suppressed === true;
            record = { ...record, suppressed: source.suppressed, present: source.present, sourceRevision: source.sourceRevision, sourceGeneration: source.sourceGeneration };
        } else if (input.type === 'inbox') {
            requireValue(typeof input.eventId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.eventId) && typeof input.linkStatus === 'string' && input.linkStatus && messages.has(`${input.chatId}/${input.messageId}`), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
            requireValue(!previous || same(previous, record), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        } else {
            const target = input.type === 'chat' ? { deleted: chat.state === 'deleted' }
                : input.type === 'message' ? messages.get(`${input.chatId}/${input.messageId}`) : candidates.get(`${input.chatId}/${input.messageId}/${input.candidateId}`);
            requireValue(target && typeof input.deleted === 'boolean' && (!input.deleted || target.deleted), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
            record.deleted = target.deleted || previous?.deleted === true;
        }
        merged.set(key, record);
    }
    manifest.deletionAndSuppressionRecords = [...merged.values()];
}

async function rootArchive(root, owner) {
    let previous;
    try { previous = await readJSON(root, '.vc-f2/migration-manifest.archive'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    requireValue(previous.formatVersion === 1 && previous.ownerAccountId === owner && Array.isArray(previous.deletionAndSuppressionRecords), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
    return previous;
}

async function completeSTEvidence(root, manifest, records, previous, signal) {
    const archived = new Map((previous?.chats || []).map((chat) => [chat.oldIdentity, chat]));
    for (const chat of manifest.chats) {
        const record = records.get(chat.oldIdentity);
        requireValue(record?.state === chat.state, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        const old = archived.get(chat.oldIdentity);
        if (!chat.messageAndCandidateIdentityRecords?.length && old?.messageAndCandidateIdentityRecords?.length) {
            // An old archive is evidence only for unchanged identity/revision domains.
            for (const field of ['kind', 'characterRef', 'groupRef', 'conversationId', 'relationshipId', 'branchRoot', 'chatRevision', 'metadataRevision', 'orderRevision', 'state']) requireValue(chat[field] === old[field], 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
            chat.messageAndCandidateIdentityRecords = structuredClone(old.messageAndCandidateIdentityRecords);
        }
        if (!chat.messageAndCandidateIdentityRecords?.length && chat.state === 'live') {
            // Initial ST domains can be reconstructed for the fully observed,
            // single-candidate subset. Unknown/absent candidates block completion.
            const sources = new Map((chat.sourceRecords || []).map((source) => [`${source.messageId}/${source.candidateId}`, source]));
            const used = new Set(); chat.messageAndCandidateIdentityRecords = [];
            await inspectJSONL(root, record.path, { signal, onRow(row, index) {
                if (!index) return;
                requireValue(!row.swipes?.length || row.swipes.length === 1, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
                const source = row.extra?.vc_source;
                const key = `${row.vc_message_id}/${source?.id}`;
                const observed = sources.get(key);
                requireValue(observed?.observed === true && observed.present === true && !used.has(key) && String(source?.revision) === observed.sourceRevision && source?.settled === observed.settled, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
                used.add(key);
                chat.messageAndCandidateIdentityRecords.push({ messageId: row.vc_message_id, messageRevision: '1', position: String(index * 1024), selectedCandidateId: source.id, deleted: false,
                    candidates: [{ candidateId: source.id, ordinal: 0, sourceRevision: observed.sourceRevision, sourceGeneration: observed.sourceGeneration, settled: observed.settled, everSelected: true, deleted: false }] });
            } });
            requireValue(used.size === sources.size, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
            chat.metadataRevision = '1'; chat.orderRevision = '1';
        }
        // The F2 ledger proves the current physical filename, never resource ownership.
        const canonical = path.posix.basename(record.path);
        const aliases = [...(old?.aliases || []), ...(record.aliases || []).map((value) => path.posix.basename(relativePath(value)))];
        if (chat.primaryFileName !== `${chat.oldIdentity}.jsonl` || chat.aliases?.some((value) => value !== chat.primaryFileName)) aliases.push(...(chat.aliases || []));
        chat.primaryFileName = canonical; chat.aliases = [...new Set([...aliases, canonical])];
        for (const id of record.deletedMessageIds || []) requireValue(chat.messageAndCandidateIdentityRecords?.some((message) => message.messageId === id && message.deleted), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        for (const id of record.deletedCandidateIds || []) requireValue(chat.messageAndCandidateIdentityRecords?.some((message) => message.candidates.some((candidate) => candidate.candidateId === id && candidate.deleted)), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        requireValue(!chat.sourceFile || chat.sourceFile === record.path, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
        chat.sourceFile = chat.state === 'live' ? record.path : '';
    }
}

export async function verifySTDrained(options, { fetchImpl = fetch, serviceToken, signal } = {}) {
    context(options);
    requireValue(options.accountHandles?.[options.ownerAccountId] && typeof serviceToken === 'string' && serviceToken.length >= 32, 'CHAT_MIGRATION_ACCESS_DENIED');
    const url = new URL(options.stBaseUrl);
    requireValue(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'CHAT_MIGRATION_ACCESS_DENIED');
    const response = await fetchImpl(`${url.origin}/internal/v1/st/chat-cutover/status`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(150_000)]),
        headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerAccountId: options.ownerAccountId, runId: options.migrationRunId, authorityEpoch: options.frozenAuthorityEpoch }),
    });
    requireValue(response.ok, 'CHAT_MIGRATION_NOT_DRAINED');
    const status = await response.json();
    requireValue(status.ownerAccountId === options.ownerAccountId && status.runId === options.migrationRunId && status.authorityEpoch === options.frozenAuthorityEpoch
        && status.state === 'DRAINED' && status.closed === true && status.durable === true && status.activeHandlers === 0, 'CHAT_MIGRATION_NOT_DRAINED');
}
async function localMarker(root, options) {
    const marker = await readJSON(root, '.vc-f2/chat-cutover.json');
    requireValue(marker.version === 1 && marker.ownerAccountId === options.ownerAccountId && marker.runId === options.migrationRunId && marker.epoch === options.frozenAuthorityEpoch && marker.closed === true, 'CHAT_MIGRATION_NOT_DRAINED');
}
async function loadFile(file) {
    const root = await safeRoot(path.dirname(path.resolve(file)));
    return readJSON(root, path.basename(file));
}
function inspectChat(chat, direction) {
    const live = chat.messageAndCandidateIdentityRecords.filter((m) => !m.deleted).sort((a, b) => BigInt(a.position) < BigInt(b.position) ? -1 : 1);
    const sources = new Map(chat.sourceRecords.map((source) => [source.candidateId, source]));
    let count = 0, candidates = 0;
    return {
        onRow(row, index) {
            if (!index) {
                const metadata = row.chat_metadata;
                requireValue(object(metadata) && metadata.vc_f2?.id === chat.oldIdentity && Number.isSafeInteger(metadata.vc_f2.revision) && String(metadata.vc_f2.revision) === chat.chatRevision);
                requireValue((metadata.vc_branch_root || chat.oldIdentity) === chat.branchRoot && !metadata.vc_f2_parent);
                const binding = metadata.vc_binding;
                if (chat.conversationId !== null) requireValue(binding?.chatIdentity === chat.oldIdentity && String(binding.conversationId) === chat.conversationId && String(binding.relationshipId) === chat.relationshipId && binding.characterRef === chat.characterRef);
                else requireValue(!binding?.conversationId && !binding?.relationshipId);
                return;
            }
            const identity = live[count++];
            requireValue(identity && identity.messageId === row.vc_message_id);
            const swipeCount = Array.isArray(row.swipes) && row.swipes.length ? row.swipes.length : 1;
            const selected = swipeCount > 1 || row.swipes?.length ? row.swipe_id ?? 0 : 0;
            requireValue(Number.isInteger(selected) && selected >= 0 && selected < swipeCount);
            const identities = identity.candidates.filter((c) => !c.deleted).sort((a, b) => a.ordinal - b.ordinal);
            requireValue(identities.length === swipeCount);
            const selectedRow = sourceMessages([{}, structuredClone(row)])[0];
            requireValue(selectedRow.candidateId === identity.selectedCandidateId);
            for (let i = 0; i < swipeCount; i++) {
                const source = i === selected ? row.extra?.vc_source : row.swipe_info?.[i]?.extra?.vc_source;
                const candidate = identities[i];
                requireValue(source?.id === candidate.candidateId && Number.isSafeInteger(source.revision) && source.revision > 0 && String(source.revision) === candidate.sourceRevision && source.settled === candidate.settled);
                if (direction === 'GO_TO_ST') requireValue(String(source.generation) === candidate.sourceGeneration);
                if (i === selected && row.swipes?.length) requireValue(same(row.swipe_info?.[i]?.extra?.vc_source, source));
                const projection = sources.get(candidate.candidateId);
                requireValue(sameInstant(source.sourceTimestamp, projection.sourceTimestamp) && (source.sourceTimezone ?? '') === (projection.sourceTimezone ?? ''), 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
                requireValue(i === selected || !projection.present, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
                if (i === selected) requireValue(projection.present === true && projection.eligible === (chat.conversationId === null ? false : selectedRow.eligible) && projection.appliedRevision === chat.chatRevision, 'CHAT_MIGRATION_SOURCE_UNAVAILABLE');
                candidates++;
            }
        },
        finish() { requireValue(count === live.length); return { messageCount: String(count), candidateCount: String(candidates) }; },
    };
}

async function ledger(root) {
    const stateDir = await safePath(root, '.vc-f2');
    const records = new Map();
    for (const entry of await fs.readdir(stateDir, { withFileTypes: true })) {
        if (entry.name === 'chat-cutover.json') continue;
        if (entry.name.endsWith('.tmp')) throw fail();
        if (!entry.name.endsWith('.json')) continue;
        requireValue(entry.isFile() && UUID.test(entry.name.slice(0, -5)));
        const record = await readJSON(root, `.vc-f2/${entry.name}`);
        requireValue(record.id === entry.name.slice(0, -5) && ['live', 'deleted'].includes(record.state));
        relativePath(record.path);
        records.set(record.id, record);
    }
    return records;
}
async function chatFiles(root, relative, result = new Set()) {
    let entries;
    try { entries = await fs.readdir(await safePath(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return result; throw error; }
    for (const entry of entries) {
        const file = `${relative}/${entry.name}`;
        requireValue(!entry.isSymbolicLink(), 'CHAT_MIGRATION_PATH_INVALID');
        if (entry.isDirectory()) await chatFiles(root, file, result);
        else if (entry.name.endsWith('.jsonl')) { requireValue(entry.isFile()); result.add(file); }
    }
    return result;
}

export async function exportSTSnapshot(options, dependencies = {}) {
    const root = await safeRoot(options.root);
    await verifySTDrained(options, dependencies);
    await localMarker(root, options);
    const manifest = await loadFile(options.supplementFile);
    matchesContext(manifest, options, 'ST_TO_GO');
    const records = await ledger(root);
    const previous = await rootArchive(root, options.ownerAccountId);
    await completeSTEvidence(root, manifest, records, previous, dependencies.signal);
    manifest.chats.forEach(validateChat);
    mergeRights(manifest, previous?.deletionAndSuppressionRecords || []);
    const files = await chatFiles(root, 'chats'); await chatFiles(root, 'group chats', files);
    requireValue(records.size === manifest.chats.length);
    return isolatedDirectory(options.artifactRoot, async (stage) => {
        const seen = new Set();
        for (const chat of manifest.chats) {
            checkAbort(dependencies.signal); validateChat(chat);
            requireValue(!seen.has(chat.oldIdentity)); seen.add(chat.oldIdentity);
            const record = records.get(chat.oldIdentity);
            requireValue(record?.state === chat.state);
            if (chat.state === 'deleted') {
                requireValue(String(record.revision) === chat.chatRevision);
                chat.sourceFile = ''; chat.sourceFileSha256 = ''; chat.sourceFileByteCount = '0'; chat.messageCount = '0'; chat.candidateCount = '0';
                continue;
            }
            requireValue(chat.sourceFile === record.path && files.delete(record.path));
            const target = `files/${chat.oldIdentity}.jsonl`;
            const inspector = inspectChat(chat, 'ST_TO_GO');
            const measured = await inspectJSONL(root, record.path, { destinationRoot: stage, destination: target, onRow: inspector.onRow, signal: dependencies.signal });
            Object.assign(chat, inspector.finish(), { sourceFile: target, sourceFileSha256: measured.sha256, sourceFileByteCount: measured.byteCount });
            requireValue(chat.metadataRevision === '1' && chat.orderRevision === '1');
        }
        requireValue(files.size === 0);
        // Recheck after all reads: a restarted or mismatched ST must never seal an archive.
        await verifySTDrained(options, dependencies); await localMarker(root, options);
        await writePrivate(stage, 'manifest.json', JSON.stringify(manifest) + '\n');
        return { chats: manifest.chats.length };
    }, dependencies);
}

export async function restoreGoSnapshot(options, { verifyCurrentGoExport, signal } = {}) {
    const archive = await safeRoot(options.artifactRoot);
    const manifest = await readJSON(archive, 'manifest.json');
    matchesContext(manifest, options, 'GO_TO_ST');
    manifest.chats.forEach(validateChat);
    mergeRights(manifest);
    const bytes = await fs.readFile(await safePath(archive, 'manifest.json'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const attestation = options.currentGoExport;
    requireValue(attestation && Object.entries(context(options)).every(([k, v]) => attestation[k] === v) && attestation.manifestSha256 === digest, 'CHAT_MIGRATION_CURRENT_GO_REQUIRED');
    if (verifyCurrentGoExport) requireValue(await verifyCurrentGoExport(manifest, attestation), 'CHAT_MIGRATION_CURRENT_GO_REQUIRED');
    return isolatedDirectory(options.root, async (stage) => {
        const seen = new Set(), paths = new Set();
        for (const chat of manifest.chats) {
            checkAbort(signal); validateChat(chat);
            requireValue(!seen.has(chat.oldIdentity)); seen.add(chat.oldIdentity);
            requireValue(BigInt(chat.chatRevision) <= BigInt(Number.MAX_SAFE_INTEGER), 'CHAT_MIGRATION_ST_REVISION_LIMIT');
            const target = scopePath(chat, options.characterDirectories);
            if (chat.state === 'live') {
                requireValue(!paths.has(target)); paths.add(target);
                const inspector = inspectChat(chat, 'GO_TO_ST');
                const measured = await inspectJSONL(archive, chat.sourceFile, { destinationRoot: stage, destination: target, onRow: inspector.onRow, signal });
                const counts = inspector.finish();
                requireValue(measured.sha256 === chat.sourceFileSha256 && measured.byteCount === chat.sourceFileByteCount && counts.messageCount === chat.messageCount && counts.candidateCount === chat.candidateCount);
            } else requireValue(!chat.sourceFile && chat.sourceFileByteCount === '0');
            await writePrivate(stage, `.vc-f2/${chat.oldIdentity}.json`, JSON.stringify({ id: chat.oldIdentity, state: chat.state, path: target, aliases: [...new Set([chat.primaryFileName, ...chat.aliases])].map((alias) => `${path.posix.dirname(target)}/${alias}`), ...(chat.state === 'deleted' ? { revision: Number(chat.chatRevision) } : {}) }) + '\n');
        }
        // F2 ignores the archive suffix. Keep all aliases, message tombstones and monotonic rights.
        await writePrivate(stage, '.vc-f2/migration-manifest.archive', JSON.stringify(manifest) + '\n');
        await writePrivate(stage, '.vc-f2/migration-resources.archive', JSON.stringify({ version: 1, ownerAccountId: options.ownerAccountId, runId: options.migrationRunId, characterDirectories: options.characterDirectories || {} }) + '\n');
        await writePrivate(stage, '.vc-f2/chat-cutover.json', JSON.stringify({ version: 1, ownerAccountId: options.ownerAccountId, runId: options.migrationRunId, epoch: options.frozenAuthorityEpoch, closed: true }) + '\n');
        return { chats: manifest.chats.length };
    }, { signal });
}

// Called only by the CLI after its owner-bound Store Verify and CAS to ST succeed.
// The root stays closed on every preceding error; no running ST instance is reopened.
export async function finalizeRestore(options) {
    const root = await safeRoot(options.root);
    await localMarker(root, options);
    const manifest = await readJSON(root, '.vc-f2/migration-manifest.archive');
    matchesContext(manifest, options, 'GO_TO_ST');
    requireValue(decimal(options.activatedAuthorityEpoch, true) && BigInt(options.activatedAuthorityEpoch) === BigInt(options.frozenAuthorityEpoch) + 1n, 'CHAT_MIGRATION_ACTIVATION_REQUIRED');
    await fs.unlink(await safePath(root, '.vc-f2/chat-cutover.json'));
    const handle = await fs.open(await safePath(root, '.vc-f2'), 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return { chats: manifest.chats.length };
}

export async function main(args, input, dependencies = {}) {
    requireValue(args.length === 1 && ['export', 'restore', 'finalize'].includes(args[0]), 'CHAT_MIGRATION_ARGUMENTS_INVALID');
    const options = JSON.parse(input);
    const env = dependencies.env || process.env;
    const config = args[0] === 'export' ? loadConfig({ VC_ST_PLUGIN_SERVICE_TOKEN: env.VC_ST_PLUGIN_SERVICE_TOKEN, VC_ST_ACCOUNT_HANDLES: JSON.stringify(options.accountHandles) }) : {};
    const result = args[0] === 'export' ? await exportSTSnapshot({ ...options, accountHandles: config.accountHandles }, { ...dependencies, serviceToken: config.serviceToken })
        : args[0] === 'restore' ? await restoreGoSnapshot(options, dependencies) : await finalizeRestore(options);
    return { status: 'OK', ...result };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const controller = new AbortController();
    const abort = () => { controller.abort(); process.stdin.destroy(); };
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    (async () => {
        let input = '';
        for await (const chunk of process.stdin) { input += chunk; requireValue(Buffer.byteLength(input) <= 1 << 20, 'CHAT_MIGRATION_ARGUMENTS_INVALID'); }
        return main(process.argv.slice(2), input, { signal: controller.signal });
    })().then((result) => process.stdout.write(JSON.stringify(result) + '\n')).catch((error) => {
        const code = typeof error.code === 'string' && /^CHAT_MIGRATION_[A-Z_]+$/.test(error.code) ? error.code : 'CHAT_MIGRATION_UNAVAILABLE';
        process.stdout.write(JSON.stringify({ status: 'UNAVAILABLE', code }) + '\n'); process.exitCode = 1;
    }).finally(() => { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); });
}
