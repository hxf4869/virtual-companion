// W10-T2：Inbox 领取只决定谁尝试写入；保存走 F2 当前读取基线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getF2Store, F2Error } from '../server-plugin/virtual-companion/lib/f2-store.js';
import { createSourceBridge, SOURCE_BRIDGE_PATH } from '../server-plugin/virtual-companion/lib/source-bridge.js';
import { createHostAuth } from '../server-plugin/virtual-companion/lib/host-auth.js';
import {
    INBOX_BRIDGE_PATH,
    attemptInboxDelivery,
    classifyInboxLink,
    createInboxBridge,
} from '../server-plugin/virtual-companion/lib/inbox-bridge.js';

const SERVICE_TOKEN = 'synthetic-inbox-service-token-0123456789abcdef0123456789';
const conflict = (error) => error instanceof F2Error && error.code === 'VC_REVISION_CONFLICT' && error.status === 409;
const eventHits = (chat, eventId) => chat.slice(1).filter((message) => message?.extra?.vc_source?.inbox_event_id === eventId);

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-inbox-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = getF2Store(root);
    const file = path.join(root, 'chats/card/main.jsonl');
    const base = await store.save(file, [
        { chat_metadata: { fixture: true } },
        { is_user: true, mes: '用户合成消息' },
    ], { expected: { id: randomUUID(), revision: 0 } });
    return { root, store, file, base };
}
function liveLease(ms = 30_000) {
    return { token: randomUUID(), expiresAt: new Date(Date.now() + ms) };
}
function countingStore(store, saves) {
    return {
        read: (...args) => store.read(...args),
        save: async (...args) => {
            saves.count += 1;
            return store.save(...args);
        },
    };
}
function serializedClaim() {
    let held = null;
    let chain = Promise.resolve();
    return (holder) => {
        const run = chain.then(() => {
            const now = Date.now();
            if (held && held.expires > now && held.holder !== holder) return { ok: false };
            if (!held || held.expires <= now) {
                const lease = { token: randomUUID(), expiresAt: new Date(now + 30_000) };
                held = { holder, expires: now + 30_000, lease };
            }
            return { ok: true, lease: held.lease };
        });
        chain = run.then(() => {}, () => {});
        return run;
    };
}

test('并发两次领取只有一方保存', async (t) => {
    const { store, file } = await fixture(t);
    const saves = { count: 0 };
    const claim = serializedClaim();
    const event = { eventId: 'fu-race', intent: 'BODY', body: '合成问候' };
    const [a, b] = await Promise.all([
        attemptInboxDelivery({ store: countingStore(store, saves), file, event, claim: () => claim('a') }),
        attemptInboxDelivery({ store: countingStore(store, saves), file, event, claim: () => claim('b') }),
    ]);
    const results = [a, b];
    assert.equal(results.filter((result) => result.saved).length, 1);
    assert.equal(results.filter((result) => result.stopped).length, 1);
    assert.equal(saves.count, 1);
    const chat = await store.read(file);
    assert.equal(eventHits(chat, event.eventId).length, 1);
    assert.equal(eventHits(chat, event.eventId)[0].mes, '合成问候');
});

test('租约已过期的一方停止尝试，不写聊天', async (t) => {
    const { store, file } = await fixture(t);
    const saves = { count: 0 };
    const expired = await attemptInboxDelivery({
        store: countingStore(store, saves), file,
        event: { eventId: 'fu-expire', intent: 'BODY', body: '不会写入' },
        lease: { token: 'expired-token', expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(expired.stopped, true);
    assert.equal(expired.saved, false);
    let nowMs = Date.now();
    const late = await attemptInboxDelivery({
        store: countingStore(store, saves), file,
        event: { eventId: 'fu-late', intent: 'BODY', body: '不会写入' },
        lease: { token: 'late-token', expiresAt: new Date(nowMs + 50) },
        now: () => new Date(nowMs),
        beforeSave() { nowMs += 1000; },
    });
    assert.equal(late.stopped, true);
    assert.equal(late.saved, false);
    assert.equal(saves.count, 0);
    assert.equal(eventHits(await store.read(file), 'fu-expire').length, 0);
    assert.equal(eventHits(await store.read(file), 'fu-late').length, 0);
});

test('ACK 前崩溃后重试仍是一条消息，并读回 chat、event、message、revision', async (t) => {
    const { store, file } = await fixture(t);
    const lease = liveLease();
    const event = { eventId: 'fu-crash', intent: 'BODY', body: '合成问候' };
    await assert.rejects(() => attemptInboxDelivery({
        store, file, event, lease,
        beforeAck() { throw new Error('ack-crash'); },
    }), /ack-crash/);
    const mid = await store.read(file);
    const hits = eventHits(mid, event.eventId);
    assert.equal(hits.length, 1);
    const again = await attemptInboxDelivery({ store, file, event, lease });
    assert.equal(again.saved, false);
    assert.equal(again.associated, true);
    assert.equal(again.acked, true);
    assert.equal(again.readback.eventId, event.eventId);
    assert.equal(again.readback.messageId, hits[0].vc_message_id);
    assert.equal(again.readback.messageRevision, hits[0].extra.vc_source.revision);
    assert.equal(again.readback.chatIdentity, mid[0].chat_metadata.vc_f2.id);
    assert.equal(Number.isSafeInteger(again.readback.chatRevision), true);
    const after = await store.read(file);
    assert.equal(after.length, mid.length);
    assert.equal(eventHits(after, event.eventId).length, 1);
    assert.equal(eventHits(after, event.eventId)[0].vc_message_id, hits[0].vc_message_id);
});

test('ACK 后旧 base revision 的整份保存被 F2 拒绝，链接仍为 present', async (t) => {
    const { store, file } = await fixture(t);
    const stale = structuredClone(await store.read(file));
    const staleToken = { ...stale[0].chat_metadata.vc_f2 };
    await store.save(file, await store.read(file), { expected: staleToken });
    const event = { eventId: 'fu-b04', intent: 'BODY', body: '合成问候' };
    const phone = await attemptInboxDelivery({ store, file, event, lease: liveLease() });
    assert.equal(phone.acked, true);
    assert.equal(phone.linkStatus, 'present');
    assert.equal(phone.readback.eventId, event.eventId);
    assert.ok(phone.readback.chatRevision > staleToken.revision);
    stale[1] = { ...stale[1], mes: '电脑旧快照' };
    await assert.rejects(store.save(file, stale, { expected: staleToken }), conflict);
    const live = await store.read(file);
    assert.equal(eventHits(live, event.eventId).length, 1);
    assert.equal(eventHits(live, event.eventId)[0].mes, '合成问候');
    const link = classifyInboxLink(live, {
        eventId: event.eventId,
        messageId: phone.readback.messageId,
        messageRevision: phone.readback.messageRevision,
        stDelivered: true,
    });
    assert.equal(link.linkStatus, 'present');
    assert.equal(link.append, false);
});

test('用户删除消息后链接变为 removed，且不新投', async (t) => {
    const { store, file } = await fixture(t);
    const event = { eventId: 'fu-delete', intent: 'BODY', body: '合成问候' };
    const saved = await attemptInboxDelivery({ store, file, event, lease: liveLease() });
    assert.equal(saved.acked, true);
    const current = await store.read(file);
    const kept = [current[0], ...current.slice(1).filter((message) => message?.extra?.vc_source?.inbox_event_id !== event.eventId)];
    await store.save(file, kept, { expected: current[0].chat_metadata.vc_f2 });
    const gone = await store.read(file);
    const link = classifyInboxLink(gone, {
        eventId: event.eventId,
        messageId: saved.readback.messageId,
        messageRevision: saved.readback.messageRevision,
        stDelivered: true,
    });
    assert.equal(link.linkStatus, 'removed');
    assert.equal(link.append, false);
    const saves = { count: 0 };
    const retry = await attemptInboxDelivery({
        store: countingStore(store, saves), file,
        event: {
            ...event, stDelivered: true,
            messageId: saved.readback.messageId,
            messageRevision: saved.readback.messageRevision,
        },
        lease: liveLease(),
    });
    assert.equal(retry.saved, false);
    assert.equal(retry.linkStatus, 'removed');
    assert.equal(saves.count, 0);
    const finalChat = await store.read(file);
    assert.equal(finalChat.length, gone.length);
    assert.equal(eventHits(finalChat, event.eventId).length, 0);
});

test('回档后链接变为 invalidated，且不新投', async (t) => {
    const { store, file } = await fixture(t);
    const event = { eventId: 'fu-rollback', intent: 'BODY', body: '合成问候' };
    const saved = await attemptInboxDelivery({ store, file, event, lease: liveLease() });
    const chat = await store.read(file);
    const rolled = structuredClone(chat);
    const target = rolled.find((message) => message?.vc_message_id === saved.readback.messageId);
    target.extra.vc_source.inbox_event_id = 'fu-other';
    const link = classifyInboxLink(rolled, {
        eventId: event.eventId,
        messageId: saved.readback.messageId,
        messageRevision: saved.readback.messageRevision,
        stDelivered: true,
    });
    assert.equal(link.linkStatus, 'invalidated');
    assert.equal(link.append, false);
    const branch = classifyInboxLink(chat, {
        eventId: event.eventId,
        messageId: saved.readback.messageId,
        messageRevision: saved.readback.messageRevision,
        branch: 'other-branch',
        stDelivered: true,
    });
    assert.equal(branch.linkStatus, 'invalidated');
    const saves = { count: 0 };
    const retry = await attemptInboxDelivery({
        store: countingStore(store, saves), file,
        event: { ...event, stDelivered: true, messageId: saved.readback.messageId, messageRevision: saved.readback.messageRevision, branch: 'other-branch' },
        lease: liveLease(),
    });
    assert.equal(retry.saved, false);
    assert.equal(retry.linkStatus, 'invalidated');
    assert.equal(saves.count, 0);
    assert.equal(eventHits(await store.read(file), event.eventId).length, 1);
});

test('WAITING_HOST 不产生聊天消息', async (t) => {
    const { store, file } = await fixture(t);
    const before = await store.read(file);
    const saves = { count: 0 };
    const result = await attemptInboxDelivery({
        store: countingStore(store, saves), file,
        event: { eventId: 'fu-wait', intent: 'WAITING_HOST', body: '不应该出现的伪回复' },
        lease: liveLease(),
    });
    assert.equal(result.waitingHost, true);
    assert.equal(result.saved, false);
    assert.equal(result.acked, false);
    assert.equal(saves.count, 0);
    const after = await store.read(file);
    assert.deepEqual(after, before);
    assert.equal(eventHits(after, 'fu-wait').length, 0);
});

test('私有 inbox 桥只接受服务令牌，读回后不回显正文', async (t) => {
    const { root, file } = await fixture(t);
    const relative = path.relative(root, file);
    const bridge = createInboxBridge({
        config: { serviceToken: SERVICE_TOKEN, accountHandles: { 101: 'ownerA' } },
        getUser: async () => ({ handle: 'ownerA', enabled: true }),
        getUserDirectories: () => ({ root }),
    });
    const hostAuth = createHostAuth({
        config: { goBaseUrl: 'http://go.invalid', timeoutMs: 1000, serviceToken: SERVICE_TOKEN, accountHandles: { 101: 'ownerA' } },
        getUser: async () => ({ handle: 'ownerA', enabled: true }),
        accountVersion: () => 'v1',
        indexHtml: () => '<html></html>',
        fetchImpl: async () => { throw new Error('inbox 桥不得触达 Go'); },
        sourceBridge: createSourceBridge({
            config: { serviceToken: SERVICE_TOKEN, accountHandles: { 101: 'ownerA' } },
            getUser: async () => ({ handle: 'ownerA', enabled: true }),
            getUserDirectories: () => ({ root }),
            inbox: bridge,
        }),
    });
    async function call(headers, body, target = INBOX_BRIDGE_PATH) {
        const req = { path: target, method: 'POST', headers, body, session: {} };
        const res = {
            statusCode: 200, headers: {}, payload: undefined,
            setHeader() {}, appendHeader() {},
            status(code) { this.statusCode = code; return this; },
            json(value) { this.payload = value; return this; },
            end() {}, redirect() {},
        };
        await hostAuth(req, res, () => {});
        return res;
    }
    const denied = await call({ authorization: 'Bearer wrong-token' }, { ownerAccountId: '101' });
    assert.equal(denied.statusCode, 401);
    const event = { eventId: 'fu-http', intent: 'BODY', body: '合成问候' };
    const ok = await call({ authorization: `Bearer ${SERVICE_TOKEN}` }, {
        ownerAccountId: '101', file: relative, event, lease: liveLease(),
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.payload.saved, true);
    assert.equal(ok.payload.readback.eventId, event.eventId);
    assert.match(ok.payload.readback.chatIdentity, /^[0-9a-f-]{36}$/);
    assert.match(ok.payload.readback.messageId, /^[0-9a-f-]{36}$/);
    assert.equal(Number.isSafeInteger(ok.payload.readback.messageRevision), true);
    assert.equal(JSON.stringify(ok.payload).includes('合成问候'), false);
    assert.equal(SOURCE_BRIDGE_PATH === INBOX_BRIDGE_PATH, false);
    const again = await call({ authorization: `Bearer ${SERVICE_TOKEN}` }, {
        ownerAccountId: '101', file: relative, event, lease: liveLease(),
    });
    assert.equal(again.payload.saved, false);
    assert.equal(again.payload.associated, true);
    assert.equal(eventHits(await getF2Store(root).read(file), event.eventId).length, 1);
});
