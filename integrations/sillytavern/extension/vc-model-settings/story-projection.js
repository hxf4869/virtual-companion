// 投影补写只认 world_event_id。已有消息只确认；墓碑还在但消息没了，视为用户删除，不补回。
export const STORY_SYNC_PENDING = '行动已生效，聊天记录待同步';

const RETRYABLE = new Set(['VC_REVISION_CONFLICT', 'VC_STALE_SOURCE', 'VC_SAVE_FAILED', 'VC_SAVE_UNCONFIRMED', 'ACK_LOST']);
const ATTEMPTS = 3;

function eventIdOf(message) {
    const extra = message?.extra;
    return extra?.type === 'vc_story_projection' && typeof extra.world_event_id === 'string' ? extra.world_event_id : '';
}

function retryable(error) {
    return RETRYABLE.has(error?.code) || error?.name === 'F2ConflictError';
}

function tombstone(metadata) {
    const raw = metadata?.vc_story_projected;
    return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [];
}

export function createStoryProjection({ readChat, saveChat, confirm }) {
    async function project(job) {
        const worldEventId = typeof job?.worldEventId === 'string' ? job.worldEventId : '';
        if (!worldEventId) return { confirmed: false, appended: false };
        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
            const chat = await readChat();
            const messages = Array.isArray(chat?.messages) ? chat.messages : [];
            const metadata = chat?.metadata && typeof chat.metadata === 'object' ? chat.metadata : {};
            if (messages.some((message) => eventIdOf(message) === worldEventId)) {
                const result = await confirm({ runId: job.runId, worldEventId });
                return { confirmed: Boolean(result?.confirmed), appended: false };
            }
            if (job.cancelled) return { skipped: 'cancelled', confirmed: false, appended: false };
            const known = tombstone(metadata);
            if (known.includes(worldEventId)) return { skipped: 'deleted', confirmed: false, appended: false };
            const nextIds = known.concat(worldEventId);
            try {
                // 不回写读到的 vc_f2：调用方会把 metadata 合并进当前聊天，旧基线会让原生保存判冲突。
                // 失败照常抛出，用当次读到的消息重试；不关闭、不屏蔽宿主打开的冲突框。
                await saveChat({
                    metadata: { vc_story_projected: nextIds },
                    messages: messages.concat([{
                        name: '剧情',
                        is_user: false,
                        mes: typeof job.text === 'string' ? job.text : '',
                        extra: { type: 'vc_story_projection', world_event_id: worldEventId },
                    }]),
                });
            } catch (error) {
                if (retryable(error) && attempt < ATTEMPTS - 1) continue;
                if (retryable(error)) return { confirmed: false, appended: false };
                throw error;
            }
            const again = await readChat();
            const saved = Array.isArray(again?.messages) && again.messages.some((message) => eventIdOf(message) === worldEventId);
            if (!saved) continue;
            const result = await confirm({ runId: job.runId, worldEventId });
            return { confirmed: Boolean(result?.confirmed), appended: true };
        }
        return { confirmed: false, appended: false };
    }
    return { project };
}
