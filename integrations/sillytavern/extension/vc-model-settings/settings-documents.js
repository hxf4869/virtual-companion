// 三个既有ST JSON文档的读取/编辑基线。只在内存保存草稿快照，磁盘仍归原ST端点。
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function settingsView(value) {
    const snapshot = copy(value);
    // Go工具续接scope属于每次请求，不是可持久偏好；切会话/新回合不能制造设置写入或多端冲突。
    for (const key of ['custom_url','reverse_proxy']) {
        const marker = snapshot?.oai_settings?.[key];
        if (typeof marker !== 'string' || !marker.startsWith('vc-go://')) continue;
        try { const url = new URL(marker); url.searchParams.delete('scope'); snapshot.oai_settings[key] = url.toString(); }
        catch { /* 无效历史标记保留原值，由既有模型投影/出站校验处理。 */ }
    }
    return snapshot;
}
export function documentEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && documentEqual(a[key], b[key]));
}
export function documentValue(document, path) {
    if (!path.length) return document === undefined ? { exists: false } : { exists: true, value: copy(document) };
    let value = document;
    for (const key of path) { if (!own(value, key)) return { exists: false }; value = value[key]; }
    return { exists: true, value: copy(value) };
}
function changedPaths(before, after, path = []) {
    if (documentEqual(before, after)) return [];
    if (object(before) && object(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .flatMap(key => changedPaths(before[key], after[key], [...path, key]));
    return [path]; // 数组整体提交，避免编辑/删除后下标漂移。
}
export function documentChanges(raw, before, after) {
    const selected = [];
    for (let path of changedPaths(before, after).sort((a, b) => a.length - b.length)) {
        // 归一化缺省对象尚未落盘时，提交最近的真实对象边界，不能假定空父节点仍存在。
        for (let length = 0; length < path.length; length++) {
            const parent = documentValue(raw, path.slice(0, length));
            if (!parent.exists || !object(parent.value)) { path = path.slice(0, length); break; }
        }
        if (!selected.some(parent => parent.length <= path.length && parent.every((key, index) => key === path[index]))) {
            for (let index = selected.length - 1; index >= 0; index--) if (path.every((key, offset) => key === selected[index][offset])) selected.splice(index, 1);
            selected.push(path);
        }
    }
    return selected.map(path => ({ path, before: documentValue(raw, path), after: documentValue(after, path) }));
}
export function applyDocumentValues(document, changes) {
    let next = document;
    for (const { path, after } of changes) {
        if (!path.length) { next = after.exists ? copy(after.value) : undefined; continue; }
        let parent = next;
        for (const key of path.slice(0, -1)) {
            if (!object(parent[key])) Object.defineProperty(parent, key, { value: {}, writable: true, configurable: true, enumerable: true });
            parent = parent[key];
        }
        if (after.exists) Object.defineProperty(parent, path.at(-1), { value: copy(after.value), writable: true, configurable: true, enumerable: true });
        else delete parent[path.at(-1)];
    }
    return next;
}

const PRESETS = { openai: ['openai_setting_names', 'openai_settings'], kobold: ['koboldai_setting_names', 'koboldai_settings'],
    novel: ['novelai_setting_names', 'novelai_settings'], textgenerationwebui: ['textgenerationwebui_preset_names', 'textgenerationwebui_presets'],
    context: ['context', 'context'], instruct: ['instruct', 'instruct'], sysprompt: ['sysprompt', 'sysprompt'], reasoning: ['reasoning', 'reasoning'] };
export function createSettingsDocuments({ post }) {
    const documents = new Map();
    const keyOf = (kind, name = '', apiId = '') => JSON.stringify([kind, name, apiId === 'koboldhorde' ? 'kobold' : apiId]);
    function capture(kind, name, apiId, raw, view = raw) {
        documents.set(keyOf(kind, name, apiId), { raw: copy(raw), view: copy(view), queue: Promise.resolve(), blocked: null });
    }
    async function save(kind, name, apiId, value) {
        const key = keyOf(kind, name, apiId);
        if (!documents.has(key)) {
            // 列表中不存在的新建文档必须携带“不存在”基线，不能覆盖并发创建的同名文件。
            if (kind === 'settings') throw new Error('配置读取基线缺失，请重新打开页面。');
            capture(kind, name, apiId, undefined);
        }
        const state = documents.get(key), readValue = typeof value === 'function' ? value : () => value;
        const fixed = typeof value === 'function' ? undefined : kind === 'settings' ? settingsView(value) : copy(value);
        const operation = state.queue.catch(() => {}).then(async () => {
            if (state.blocked) throw state.blocked;
            const submitted=typeof value==='function'?(kind==='settings'?settingsView(readValue()):copy(readValue())):fixed;
            const snapshot = kind === 'preset' && object(state.raw) ? { ...copy(state.raw), ...submitted } : submitted;
            const changes = documentChanges(state.raw, state.view, snapshot);
            const url = kind === 'settings' ? '/api/settings/save' : kind === 'preset' ? '/api/presets/save' : '/api/worldinfo/edit';
            const response = await post(url, { ...(kind !== 'settings' ? { name } : {}), ...(kind === 'preset' ? { apiId } : {}), vc_changes: changes });
            if (!response.ok) {
                const error = new Error(response.status === 409 ? '配置已在另一处更新，你的修改尚未保存。' : '配置没有保存，请重试。');
                error.status = response.status; error.code = (await response.clone().json().catch(() => ({}))).code;
                throw error;
            }
            state.raw = applyDocumentValues(state.raw, changes);
            state.view = applyDocumentValues(state.view,changes.map(change=>({path:change.path,after:documentValue(snapshot,change.path)})));
            return response;
        }).catch(error => { if ([401,403,409].includes(error.status)) state.blocked = error; throw error; });
        state.queue = operation;
        return operation;
    }
    return {
        captureSettings(raw, view = raw) { capture('settings', '', '', raw, settingsView(view)); },
        settingsChanged(value) { const state = documents.get(keyOf('settings')); return !state || !documentEqual(state.view, settingsView(value)); },
        captureWorldbook(name, data) { capture('worldbook', name, '', data); },
        capturePreset(apiId, name, data) { capture('preset', name, apiId, data); },
        acceptPreset(apiId,name,changes,current) {
            const state=documents.get(keyOf('preset',name,apiId));
            if(!state){capture('preset',name,apiId,current);return;}
            state.raw=applyDocumentValues(state.raw,changes);
            state.view=applyDocumentValues(state.view,changes.map(change=>({path:change.path,after:documentValue(current,change.path)})));
            state.blocked=null;
        },
        seedPresets(packet) {
            for (const [apiId, [namesKey, valuesKey]] of Object.entries(PRESETS)) {
                if (namesKey === valuesKey) {
                    for (const preset of packet[valuesKey] || []) if (preset?.name && !documents.has(keyOf('preset', preset.name, apiId))) capture('preset', preset.name, apiId, preset);
                } else {
                    for (const [index, name] of (packet[namesKey] || []).entries()) if (!documents.has(keyOf('preset', name, apiId))) {
                        const source = packet[valuesKey][index]; capture('preset', name, apiId, typeof source === 'string' ? JSON.parse(source) : source);
                    }
                }
            }
        },
        acceptSettings(changes, current) {
            const state = documents.get(keyOf('settings'));
            if (!state) throw new Error('配置读取基线缺失，请重新打开页面。');
            state.raw = applyDocumentValues(state.raw, changes);
            state.view = applyDocumentValues(state.view, changes.map(change => ({ path: change.path, after: documentValue(settingsView(current), change.path) })));
            state.blocked = null;
        },
        projectSettings(paths,current) {
            const state=documents.get(keyOf('settings'));if(!state)return;
            state.view=applyDocumentValues(state.view,paths.map(path=>({path,after:documentValue(settingsView(current),path)})));
        },
        saveSettings: value => save('settings', '', '', value),
        savePreset: (apiId, name, value) => save('preset', name, apiId, value),
        saveWorldbook: (name, value) => save('worldbook', name, '', value),
    };
}
