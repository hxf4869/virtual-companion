// 投影补写提交前核对读到的消息基线。宿主在读取之后追加的消息不能被快照 splice 掉。
import { F2ConflictError } from './f2-client.js';

function eventId(message) {
    const extra = message?.extra;
    return extra?.type === 'vc_story_projection' && typeof extra.world_event_id === 'string' ? extra.world_event_id : '';
}

function projectionBase(liveMessages, snapshotMessages) {
    const live = Array.isArray(liveMessages) ? liveMessages : [];
    const next = Array.isArray(snapshotMessages) ? snapshotMessages : [];
    const known = new Set(live.map(eventId).filter(Boolean));
    let end = next.length;
    while (end > 0) {
        const id = eventId(next[end - 1]);
        if (!id || known.has(id)) break;
        end -= 1;
    }
    return next.slice(0, end);
}

export function commitStoryProjectionSave(ctx, snapshot) {
    const live = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const base = projectionBase(live, snapshot?.messages);
    if (live.length !== base.length || base.some((message, index) => live[index] !== message)) {
        throw new F2ConflictError('VC_STALE_SOURCE');
    }
    const metadata = snapshot?.metadata;
    if (ctx?.chatMetadata && metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
            if (key === 'vc_f2' || key === 'vc_f2_parent') continue;
            ctx.chatMetadata[key] = value;
        }
    }
    if (Array.isArray(ctx?.chat)) ctx.chat.splice(0, ctx.chat.length, ...(snapshot?.messages || []));
}
