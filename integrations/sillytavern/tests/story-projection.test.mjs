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

function installConflictDialog({ open = false } = {}) {
    const realDocument = globalThis.document;
    const realDialog = globalThis.HTMLDialogElement;
    let opened = 0;
    let closed = 0;
    class Dialog {
        constructor() {
            this.id = 'vc-f2-conflict';
            this.open = open;
        }
    }
    function showModal() {
        this.open = true;
        opened += 1;
    }
    function close() {
        this.open = false;
        closed += 1;
    }
    Dialog.prototype.showModal = showModal;
    Dialog.prototype.close = close;
    const dialog = new Dialog();
    globalThis.HTMLDialogElement = Dialog;
    globalThis.document = { querySelector: (selector) => (selector === '#vc-f2-conflict' ? dialog : null) };
    return {
        dialog,
        showModal,
        close,
        opened: () => opened,
        closed: () => closed,
        restore() {
            globalThis.document = realDocument;
            globalThis.HTMLDialogElement = realDialog;
        },
    };
}

function conflict(message) {
    const error = new Error(message);
    error.code = 'VC_REVISION_CONFLICT';
    error.name = 'F2ConflictError';
    return error;
}

test('旧 vc_f2 回写会让原生保存判冲突；只提交墓碑时不打开冲突框且只写一次', async () => {
    const ui = installConflictDialog();
    const token = { id: 'chat-1', revision: 1 };
    let messages = [{ mes: '旧消息' }];
    let projected = [];
    const writes = [];
    try {
        const { projection, confirmed } = harness(
            async () => ({
                metadata: { vc_f2: { ...token }, vc_story_projected: projected.slice(), host: 'keep' },
                messages: messages.map((message) => ({ ...message })),
            }),
            async (snapshot) => {
                assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
                assert.equal(globalThis.HTMLDialogElement.prototype.close, ui.close);
                // 原生保存把快照里的 vc_f2 当作基线；回写读到的旧修订即判冲突并打开冲突框。
                if (Object.hasOwn(snapshot.metadata, 'vc_f2')) {
                    ui.dialog.showModal();
                    throw conflict('stale token');
                }
                writes.push(snapshot);
                messages = snapshot.messages.map((message) => ({ ...message }));
                projected = snapshot.metadata.vc_story_projected.slice();
            },
        );
        const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
        assert.equal(result.confirmed, true);
        assert.equal(result.appended, true);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].metadata, { vc_story_projected: ['101'] });
        assert.equal(token.revision, 1);
        assert.deepEqual(projected, ['101']);
        assert.equal(writes[0].messages.some((message) => message.mes === '旧消息'), true);
        assert.equal(writes[0].messages.filter((message) => message.extra?.world_event_id === '101').length, 1);
        assert.equal(ui.dialog.open, false);
        assert.equal(ui.opened(), 0);
        assert.equal(ui.closed(), 0);
        assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
        assert.deepEqual(confirmed, ['101']);
    } finally {
        ui.restore();
    }
});

test('宿主在补写读与写之间更新时不覆盖新消息，冲突框保持可见', async () => {
    const ui = installConflictDialog();
    let messages = [{ mes: '旧消息' }];
    let live = { vc_f2: { id: 'chat-1', revision: 1 }, vc_story_projected: [] };
    let raced = false;
    let attempts = 0;
    const committed = [];
    try {
        const { projection, confirmed } = harness(
            async () => ({
                metadata: { ...live, vc_f2: { ...live.vc_f2 } },
                messages: messages.map((message) => ({ ...message })),
            }),
            async (snapshot) => {
                attempts += 1;
                assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
                assert.equal(globalThis.HTMLDialogElement.prototype.close, ui.close);
                if (!raced) {
                    raced = true;
                    messages = [{ mes: '旧消息' }, { mes: '原生新消息' }];
                    live = { ...live, vc_f2: { id: 'chat-1', revision: 2 } };
                    ui.dialog.showModal();
                    throw conflict('conflict');
                }
                if (!snapshot.messages.some((message) => message.mes === '原生新消息')
                    || (Object.hasOwn(snapshot.metadata, 'vc_f2') && snapshot.metadata.vc_f2.revision !== live.vc_f2.revision)) {
                    ui.dialog.showModal();
                    throw conflict('conflict');
                }
                committed.push(snapshot);
                messages = snapshot.messages.map((message) => ({ ...message }));
                live = { ...live, vc_story_projected: snapshot.metadata.vc_story_projected };
            },
        );
        const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
        assert.equal(result.confirmed, true);
        assert.equal(result.appended, true);
        assert.equal(attempts, 2);
        assert.equal(committed.length, 1);
        assert.equal(live.vc_f2.revision, 2);
        assert.deepEqual(committed[0].metadata, { vc_story_projected: ['101'] });
        assert.equal(messages.filter((message) => message.mes === '原生新消息').length, 1);
        assert.equal(messages.filter((message) => message.extra?.world_event_id === '101').length, 1);
        assert.equal(ui.dialog.open, true);
        assert.equal(ui.opened(), 1);
        assert.equal(ui.closed(), 0);
        assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
        assert.equal(globalThis.HTMLDialogElement.prototype.close, ui.close);
        assert.deepEqual(confirmed, ['101']);
    } finally {
        ui.restore();
    }
});

test('补写前已经打开的冲突框保持打开，保存失败仍不覆盖', async () => {
    const ui = installConflictDialog({ open: true });
    let writes = 0;
    const seen = [];
    try {
        const { projection } = harness(
            async () => ({ metadata: { vc_f2: { id: 'chat-1', revision: 4 } }, messages: [{ mes: '已保存' }] }),
            async (snapshot) => {
                writes += 1;
                seen.push(snapshot.messages.map((message) => message.mes));
                assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
                assert.equal(globalThis.HTMLDialogElement.prototype.close, ui.close);
                throw conflict('conflict');
            },
        );
        const result = await projection.project({ runId: '11', worldEventId: '101', text: LINE, cancelled: false });
        assert.equal(result.confirmed, false);
        assert.equal(result.appended, false);
        assert.equal(ui.dialog.open, true);
        assert.equal(ui.closed(), 0);
        assert.equal(writes, 3);
        assert.deepEqual(seen, [
            ['已保存', LINE],
            ['已保存', LINE],
            ['已保存', LINE],
        ]);
        assert.equal(globalThis.HTMLDialogElement.prototype.showModal, ui.showModal);
    } finally {
        ui.restore();
    }
});
