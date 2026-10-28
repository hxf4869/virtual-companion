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
