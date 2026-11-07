// Resolve logical native chat scope from authenticated, owned resource files.
// Raw chat JSONL is never read here, and uploaded binding IDs grant no access.
import fs from 'node:fs/promises';
import path from 'node:path';

function failure(status = 403, code = 'ACCESS_DENIED') { return Object.assign(new Error(code), { status, code }); }
function basename(value) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\x00]/.test(value)) throw failure(400, 'INVALID_REQUEST');
    return value;
}
async function resourceDirectory(root, directory) {
    if (!root || !directory) throw failure();
    const relative = path.relative(path.resolve(root), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure();
    let current = path.resolve(root);
    for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        const entry = await fs.lstat(current);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw failure();
    }
    return current;
}
async function resourceFile(directory, name) {
    const file = path.join(directory, basename(name));
    const entry = await fs.lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw failure();
    return file;
}
function stem(value) { return String(value).replace(/\.jsonl$/, ''); }

export function createNativeChatScopeResolver({ decodeCharacter }) {
    async function character(directory, avatar) {
        const file = await resourceFile(directory, avatar);
        const card = await decodeCharacter(await fs.readFile(file));
        const ref = card?.data?.extensions?.vc_character_ref ?? card?.extensions?.vc_character_ref;
        if (typeof ref !== 'string' || !ref) return null;
        return { scope: { kind: 'SINGLE', characterRef: ref }, avatar };
    }
    async function groups(directory) {
        const out = [];
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (!entry.name.endsWith('.json')) continue;
            const file = await resourceFile(directory, entry.name);
            let group;
            try { group = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw failure(503, 'SCHEMA_UNAVAILABLE'); }
            // Native group IDs are already stable, owner-local resource IDs.
            const id = typeof group?.id === 'string' || Number.isSafeInteger(group?.id) ? String(group.id) : '';
            if (!id || entry.name !== id + '.json' || !Array.isArray(group.chats)) throw failure(503, 'SCHEMA_UNAVAILABLE');
            out.push({ scope: { kind: 'GROUP', groupRef: id }, id,
                files: new Set([...group.chats, group.chat_id].filter(value => typeof value === 'string').map(stem)) });
        }
        return out;
    }
    return async function resolveNativeChatScope({ req, body, path: route, signal }) {
        signal?.throwIfAborted();
        if (!req.vcIdentity?.handle || req.user?.profile?.handle !== req.vcIdentity.handle) throw failure();
        const dirs = req.user.directories;
        const ownerWide = ['/api/chats/recent', '/api/chats/search'].includes(route) && !body.avatar_url;
        const groupChat = route.includes('/group/') || body.is_group === true;
        if (groupChat) {
            const rows = await groups(await resourceDirectory(dirs.root, dirs.groups));
            const file = stem(body.id ?? body.file ?? body.file_name ?? body.original_file);
            const matches = rows.filter(row => row.files.has(file));
            if (matches.length !== 1) throw failure(matches.length ? 409 : 404, matches.length ? 'REVISION_CONFLICT' : 'NOT_FOUND_OR_FORBIDDEN');
            return { scope: matches[0].scope, groupIds: { [matches[0].scope.groupRef]: matches[0].id } };
        }
        if (!ownerWide) {
            const directory = await resourceDirectory(dirs.root, dirs.characters);
            const found = await character(directory, basename(body.avatar_url));
            signal?.throwIfAborted();
            if (!found) throw failure(404, 'NOT_FOUND_OR_FORBIDDEN');
            // Mode is only a controlled requested intent. Go validates any
            // existing onboarding binding for this exact proposed chatId;
            // no uploaded conversation/relationship/Owner ID is forwarded.
            const requestedMode = body.vc_mode ?? body.chat?.[0]?.chat_metadata?.vc_binding?.mode ?? 'COMPANION';
            if (!['COMPANION', 'STORY'].includes(requestedMode)) throw failure(400, 'INVALID_REQUEST');
            return { ...found, mode: requestedMode };
        }
        const scopes = [], avatars = {}, groupIds = {};
        const directory = await resourceDirectory(dirs.root, dirs.characters);
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (!entry.name.endsWith('.png')) continue;
            const found = await character(directory, entry.name);
            if (!found) continue;
            if (avatars[found.scope.characterRef]) throw failure(409, 'REVISION_CONFLICT');
            scopes.push(found.scope); avatars[found.scope.characterRef] = found.avatar;
        }
        for (const row of await groups(await resourceDirectory(dirs.root, dirs.groups))) {
            scopes.push(row.scope); groupIds[row.scope.groupRef] = row.id;
        }
        signal?.throwIfAborted();
        return { scopes, avatars, groupIds };
    };
}
