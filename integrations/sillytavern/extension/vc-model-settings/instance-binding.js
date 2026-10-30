// W05 实例绑定薄层。调用方提供源快照并负责在正确 F2 生命周期内应用结果。
// 不监听事件、不写宿主 metadata，也不缓存已完成的跨会话结果。
export class StaleBindingError extends Error {
    constructor() {
        super('聊天已切换，旧的实例绑定结果未应用。');
        this.name = 'StaleBindingError';
    }
}

/** 扩展目录和 vc-runtime 各有一份模块，内存不共享。绑定完成后用 DOM 标记通知引导层收起。 */
export function noteCompanionBound(doc = globalThis.document) {
    const target = doc?.body || doc;
    target?.setAttribute?.('data-vc-st-bound', '1');
    if (typeof target?.dispatchEvent === 'function') target.dispatchEvent(new Event('vc-st-bound'));
    else target?.dispatch?.('vc-st-bound');
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

/** 0.5 秒内相同聊天身份只解析一次。不同聊天身份各自建会话，不能因为还没写上关系就并成一次。 */
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

function onboardingBindState() {
    // 扩展目录和 /scripts/vc-runtime 会各加载一份本模块。挂起状态必须共用，否则引导按住的是另一份。
    const root = globalThis;
    if (!root.__vcOnboardingBind) root.__vcOnboardingBind = { hold: 0, pending: null };
    return root.__vcOnboardingBind;
}

export function holdCompanionBinding(hold) {
    const state = onboardingBindState();
    state.hold += hold ? 1 : -1;
    if (state.hold < 0) state.hold = 0;
}

export function companionBindingHeld() {
    return onboardingBindState().hold > 0;
}

export function armOnboardingBinding(payload) {
    onboardingBindState().pending = payload?.binding?.relationshipId ? payload : null;
}

export function clearOnboardingBinding() {
    onboardingBindState().pending = null;
}

export function takeOnboardingBinding(characterRef) {
    const pending = onboardingBindState().pending;
    if (!pending) return null;
    if (pending.characterRef && characterRef && pending.characterRef !== characterRef) return null;
    return pending;
}
