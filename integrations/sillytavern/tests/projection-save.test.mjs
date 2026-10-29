import test from 'node:test';
import assert from 'node:assert/strict';
import { F2ConflictError } from '../extension/vc-model-settings/f2-client.js';
import { commitStoryProjectionSave } from '../extension/vc-model-settings/projection-save.js';

const base = () => ({ mes: '原消息', is_user: false });
const projection = (id) => ({
    mes: '剧情',
    is_user: false,
    extra: { type: 'vc_story_projection', world_event_id: id },
});

test('读写之间宿主新增消息且 vc_f2 未变时拒绝覆盖，并抛 F2ConflictError', () => {
    const kept = base();
    const host = { mes: '宿主新消息', is_user: true };
    const metadata = { vc_f2: { id: 'chat', revision: 4 }, vc_story_projected: [] };
    const ctx = { chat: [kept, host], chatMetadata: metadata };
    const snapshot = {
        metadata: { vc_f2: { id: 'chat', revision: 4 }, vc_story_projected: ['evt-1'] },
        messages: [kept, projection('evt-1')],
    };
    assert.throws(() => commitStoryProjectionSave(ctx, snapshot), (error) => {
        assert.equal(error.name, 'F2ConflictError');
        assert.equal(error.code, 'VC_STALE_SOURCE');
        assert.ok(error instanceof F2ConflictError);
        return true;
    });
    assert.deepEqual(ctx.chat, [kept, host]);
    assert.deepEqual(metadata.vc_f2, { id: 'chat', revision: 4 });
    assert.deepEqual(metadata.vc_story_projected, []);
});

test('基线未变时追加投影，且不回写快照里的 vc_f2', () => {
    const kept = base();
    const metadata = { vc_f2: { id: 'chat', revision: 4 } };
    const ctx = { chat: [kept], chatMetadata: metadata };
    const added = projection('evt-2');
    commitStoryProjectionSave(ctx, {
        metadata: { vc_f2: { id: 'chat', revision: 1 }, vc_f2_parent: { id: 'old', revision: 1 }, vc_story_projected: ['evt-2'] },
        messages: [kept, added],
    });
    assert.equal(ctx.chat.length, 2);
    assert.equal(ctx.chat[0], kept);
    assert.equal(ctx.chat[1], added);
    assert.deepEqual(metadata.vc_f2, { id: 'chat', revision: 4 });
    assert.equal(metadata.vc_f2_parent, undefined);
    assert.deepEqual(metadata.vc_story_projected, ['evt-2']);
});
