// W05 实例绑定薄层。调用方提供源快照并负责在正确 F2 生命周期内应用结果。
// 不监听事件、不写宿主 metadata，也不缓存已完成的跨会话结果。
export class StaleBindingError extends Error {
    constructor() {
        super('聊天已切换，旧的实例绑定结果未应用。');
        this.name = 'StaleBindingError';
    }
}

export function createInstanceBinding({ resolveBinding, getSource }) {
    const inflight = new Map();

    function ensure(sourceSnapshot) {
        const snapshot = {
            chatIdentity: sourceSnapshot.chatIdentity,
            characterRef: sourceSnapshot.characterRef,
            mode: sourceSnapshot.mode,
            relationshipId: sourceSnapshot.relationshipId,
            displayName: sourceSnapshot.displayName,
        };
        const key = JSON.stringify(snapshot);
        if (inflight.has(key)) return inflight.get(key);

        const assertCurrent = () => {
            const current = getSource();
            if (current?.chatIdentity !== snapshot.chatIdentity
                || current?.characterRef !== snapshot.characterRef
                || current?.mode !== snapshot.mode) {
                throw new StaleBindingError();
            }
        };
        const pending = Promise.resolve().then(() => resolveBinding(snapshot)).then(
            (body) => { assertCurrent(); return body; },
            (error) => { assertCurrent(); throw error; },
        ).finally(() => inflight.delete(key));
        inflight.set(key, pending);
        return pending;
    }

    return { ensure };
}

/** 同一未绑定角色卡在 0.5 秒内的重复解析合并为一次。已绑定的会话按关系与聊天身份分开。 */
const BINDING_WINDOW_MS = 500;
const bindingSlots = new Map();

export function resetBindingCoalesce() {
    bindingSlots.clear();
}

export function bindingCoalesceKey(payload = {}) {
    const mode = payload.mode === 'STORY' ? 'STORY' : 'COMPANION';
    const ref = String(payload.characterRef || '');
    const identity = String(payload.chatIdentity || '');
    const relationshipId = payload.relationshipId == null || payload.relationshipId === '' ? '' : String(payload.relationshipId);
    if (relationshipId) return `rel:${mode}:${relationshipId}:${identity}`;
    if (mode === 'COMPANION') return `new:${mode}:${ref}`;
    return `new:${mode}:${ref}:${identity}`;
}

export function coalesceBinding(key, run, now = Date.now) {
    const slot = bindingSlots.get(key);
    const stamp = now();
    if (slot && (slot.pending || stamp - slot.doneAt < BINDING_WINDOW_MS)) return slot.promise;
    const entry = { pending: true, doneAt: 0, promise: null };
    entry.promise = Promise.resolve().then(run).then(
        (value) => {
            entry.pending = false;
            entry.doneAt = now();
            return value;
        },
        (error) => {
            entry.pending = false;
            if (bindingSlots.get(key) === entry) bindingSlots.delete(key);
            throw error;
        },
    );
    bindingSlots.set(key, entry);
    return entry.promise;
}
