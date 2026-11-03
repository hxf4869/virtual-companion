// AGPL-3.0-only. 原ST JSON保存端点的局部提交；临界段内不await，不维护版本侧库。
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const validState = state => object(state) && typeof state.exists === 'boolean' && (!state.exists || own(state, 'value'));
class CommitError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const invalid = () => { throw new CommitError(400, 'VC_DOCUMENT_INVALID'); };
const conflict = () => { throw new CommitError(409, 'VC_DOCUMENT_CONFLICT'); };

function readAt(document, path) {
    if (!path.length) return document === undefined ? { exists: false } : { exists: true, value: document };
    let cursor = document;
    for (let index = 0; index < path.length; index++) {
        if (Array.isArray(cursor)) invalid(); // 数组是整体编辑边界，不接受下标漂移。
        if (!object(cursor)) conflict();
        if (!own(cursor, path[index])) {
            if (index !== path.length - 1) conflict();
            return { exists: false };
        }
        cursor = cursor[path[index]];
    }
    return { exists: true, value: cursor };
}

function validateChanges(changes) {
    if (!Array.isArray(changes)) invalid();
    const paths = new Set();
    for (const change of [...changes].sort((a, b) => (a?.path?.length || 0) - (b?.path?.length || 0))) {
        if (!object(change) || !Array.isArray(change.path) || change.path.some(key => typeof key !== 'string' || !key || unsafe.has(key))
            || !validState(change.before) || !validState(change.after)) invalid();
        for (let length = 0; length <= change.path.length; length++) if (paths.has(JSON.stringify(change.path.slice(0, length)))) invalid();
        paths.add(JSON.stringify(change.path));
    }
}

export function applyDocumentChanges(document, changes) {
    validateChanges(changes);
    // 先比较全部旧值，禁止部分提交。
    for (const change of changes) if (!isDeepStrictEqual(readAt(document, change.path), change.before)) conflict();
    let next = structuredClone(document);
    for (const { path, after } of changes) {
        if (!path.length) { if (!after.exists) invalid(); next = structuredClone(after.value); continue; }
        let parent = next;
        for (const key of path.slice(0, -1)) parent = parent[key];
        const key = path.at(-1);
        if (after.exists) Object.defineProperty(parent, key, { value: structuredClone(after.value), enumerable: true, configurable: true, writable: true });
        else delete parent[key];
    }
    return next;
}

// 只有原端点解析出的可信文件路径可以传入；未带vc_changes继续原完整替换语义。
export function commitDocument(request, response, file, { write, result, validate = object, allowCreate = false }) {
    if (!own(request.body || {}, 'vc_changes')) return false;
    if (!request.user?.profile?.handle || !request.user?.directories?.root) {
        response.status(401).json({ code: 'VC_AUTH_REQUIRED', message: '需要已认证宿主用户。' }); return true;
    }
    try {
        let current;
        try { current = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current === undefined && !allowCreate) conflict();
        const next = applyDocumentChanges(current, request.body.vc_changes);
        if (!validate(next)) invalid();
        if (request.body.vc_changes.length) write(next);
        response.json(result);
    } catch (error) {
        const status = error instanceof CommitError ? error.status : 503;
        response.status(status).json({ code: error instanceof CommitError ? error.code : 'VC_DOCUMENT_UNAVAILABLE',
            message: status === 409 ? '配置已在另一处更新，你的修改尚未保存。' : status === 400 ? '配置修改未通过校验。' : '配置暂时没有保存，请重试。' });
    }
    return true;
}
