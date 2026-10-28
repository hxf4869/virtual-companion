// W14-T4：投影按 world_event_id 幂等补写。不接触真实聊天文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryProjection, STORY_SYNC_PENDING } from '../extension/vc-model-settings/story-projection.js';

const LINE = '发现证据：钥匙借用记录';

function harness(readChat, saveChat, confirm) {
    const confirmed = [];
    const projection = createStoryProjection({
        readChat,
        saveChat,
        confirm: confirm || (async ({ worldEventId }) => {
            confirmed.push(worldEventId);
            return { confirmed: true, worldEventId };
        }),
    });
    return { projection, confirmed };
}

test('待同步文案是固定句子', () => {
    assert.equal(STORY_SYNC_PENDING, '行动已生效，聊天记录待同步');
});

test('读回已有同一 world_event_id 只确认，不追加', async () => {
    let saves = 0;
    const { projection, confirmed } = harness(
        async () => ({
            metadata: { vc_story_projected: ['101'] },
            messages: [{ mes: LINE, extra: { type: 'vc_story_projection', world_event_id: '101' } }],
        }),
        async () => { saves += 1; },
        async () => ({ confirmed: true }),
    );
    const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
    assert.equal(saves, 0);
    assert.equal(result.appended, false);
    assert.equal(result.confirmed, true);
    assert.deepEqual(confirmed, []);
});

test('F2 冲突后只再次保存同一个 world_event_id', async () => {
    const savedIds = [];
    let messages = [];
    let metadata = {};
    let failures = 1;
    const { projection, confirmed } = harness(
        async () => ({ metadata, messages }),
        async (snapshot) => {
            const id = snapshot.messages.at(-1)?.extra?.world_event_id;
            savedIds.push(id);
            if (failures > 0) {
                failures -= 1;
                const error = new Error('conflict');
                error.code = 'VC_REVISION_CONFLICT';
                error.name = 'F2ConflictError';
                throw error;
            }
            messages = snapshot.messages;
            metadata = snapshot.metadata;
        },
    );
    const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
    assert.deepEqual(savedIds, ['101', '101']);
    assert.equal(messages.filter((message) => message.extra?.world_event_id === '101').length, 1);
    assert.equal(result.confirmed, true);
    assert.deepEqual(confirmed, ['101']);
    assert.deepEqual(metadata.vc_story_projected, ['101']);
    assert.equal(JSON.stringify(metadata).includes(LINE), false);
});

test('保存回执丢失后读回已有消息并确认，不再追加', async () => {
    let messages = [];
    let metadata = {};
    let saves = 0;
    const { projection, confirmed } = harness(
        async () => ({ metadata, messages }),
        async (snapshot) => {
            saves += 1;
            messages = snapshot.messages;
            metadata = snapshot.metadata;
            const error = new Error('ack lost');
            error.code = 'ACK_LOST';
            error.name = 'F2ConflictError';
            throw error;
        },
    );
    const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
    assert.equal(saves, 1);
    assert.equal(messages.filter((message) => message.extra?.world_event_id === '101').length, 1);
    assert.equal(result.appended, false);
    assert.equal(result.confirmed, true);
    assert.deepEqual(confirmed, ['101']);
});

test('回档取消的投影不补写，用户删掉的投影不自动补回', async () => {
    let saves = 0;
    let confirms = 0;
    const { projection } = harness(
        async () => ({ metadata: {}, messages: [] }),
        async () => { saves += 1; },
        async () => { confirms += 1; return { confirmed: true }; },
    );
    const cancelled = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: true });
    assert.equal(cancelled.skipped, 'cancelled');
    assert.equal(saves, 0);
    assert.equal(confirms, 0);
    const deleted = createStoryProjection({
        readChat: async () => ({ metadata: { vc_story_projected: ['202'] }, messages: [{ mes: '别的消息' }] }),
        saveChat: async () => { saves += 1; },
        confirm: async () => { confirms += 1; return { confirmed: true }; },
    });
    const gone = await deleted.project({ runId: '11', worldEventId: '202', text: LINE, cancelled: false });
    assert.equal(gone.skipped, 'deleted');
    assert.equal(saves, 0);
    assert.equal(confirms, 0);
});
