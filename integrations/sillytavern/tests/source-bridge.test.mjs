// W06 source-bridge 私有路由合同离线单测（node --test，随 tests/*.test.mjs 通配并入 scripts/check.sh 全量）。
// 被测对象：../server-plugin/virtual-companion/lib/source-bridge.js 经 host-auth 的精确 POST 私有路由
// （均为生产代码，不在测试中修改）。用真实 F2Store 在 os.tmpdir() 临时 owner 根目录落盘合成聊天数据驱动，
// 不复刻实现逻辑；fetchImpl 直接抛错，证明该路由完全离线且不触达 Go。凭据与内容全部合成。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSourceBridge, SOURCE_BRIDGE_PATH } from '../server-plugin/virtual-companion/lib/source-bridge.js';
import { createHostAuth } from '../server-plugin/virtual-companion/lib/host-auth.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';

const SERVICE_TOKEN = 'synthetic-bridge-service-token-0123456789abcdef0123456789';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const auth = { authorization: `Bearer ${SERVICE_TOKEN}` };
const fresh = () => ({ id: randomUUID(), revision: 0 });
const chatRows = (texts = ['用户合成消息', '助手合成消息']) => [
    { chat_metadata: { fixture: true } },
    { is_user: true, mes: texts[0] },
    { is_user: false, mes: texts[1] },
];
const snapshotOf = (result) => result.res.payload?.snapshots;

async function tempRoot(t, prefix) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

// 经生产挂载点（createHostAuth 注入 sourceBridge 的中间件）驱动 HTTP 层。
function harness(t, accounts, { serviceToken = SERVICE_TOKEN } = {}) {
    const byHandle = new Map(accounts.map((account) => [account.handle, account]));
    const accountHandles = Object.fromEntries(accounts.map((account) => [account.accountId, account.handle]));
    const getUser = async (handle) => {
        const account = byHandle.get(handle);
        return account ? { handle: account.handle, enabled: true } : undefined;
    };
    const hostAuth = createHostAuth({
        config: { goBaseUrl: 'http://go.invalid', timeoutMs: 1000, serviceToken, accountHandles },
        getUser,
        accountVersion: () => 'v1',
        indexHtml: () => '<html><head></head><body></body></html>',
        fetchImpl: async () => { throw new Error('source bridge 路由不得触达 Go'); },
        sourceBridge: createSourceBridge({
            config: { serviceToken, accountHandles },
            getUser,
            getUserDirectories: (handle) => ({ root: byHandle.get(handle).root }),
        }),
    });
    async function call({ body, method = 'POST', target = SOURCE_BRIDGE_PATH, headers = {} } = {}) {
        const req = { path: target, method, headers, body, session: {} };
        const res = { statusCode: 200, headers: {}, payload: undefined,
            setHeader(name, value) { this.headers[name] = value; },
            appendHeader(name, value) { this.headers[name] = value; },
            status(code) { this.statusCode = code; return this; },
            json(value) { this.payload = value; return this; },
            end(value) { this.payload = value; },
            redirect(code, url) { this.statusCode = code; this.headers.Location = url; },
        };
        let next = false;
        await hostAuth(req, res, () => { next = true; });
        return { res, next };
    }
    return { call };
}

test('无服务令牌或错误服务令牌均被拒；宿主未配置令牌时路由同样不可用', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const body = { ownerAccountId: '101', chats: [{ chatIdentity: randomUUID() }] };
    const wrongTokens = [
        undefined,
        'Bearer wrong-token',
        `Bearer ${'x'.repeat(SERVICE_TOKEN.length)}`, // 等长错误令牌，覆盖恒定时间比较分支
        SERVICE_TOKEN, // 缺 Bearer 方案前缀
    ];
    for (const configured of [SERVICE_TOKEN, '']) {
        const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }], { serviceToken: configured });
        for (const authorization of wrongTokens) {
            const { res } = await call({ body, headers: authorization === undefined ? {} : { authorization } });
            assert.equal(res.statusCode, 401);
            assert.deepEqual(res.payload, { code: 'AUTHENTICATION_REQUIRED' });
            assert.equal(res.headers['Cache-Control'], 'no-store');
        }
    }
});

test('携带 Origin 的请求被拒且优先于服务令牌校验', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const body = { ownerAccountId: '101', chats: [{ chatIdentity: randomUUID() }] };
    for (const origin of ['https://attacker.example', 'http://127.0.0.1:8000', 'null']) {
        const { res } = await call({ body, headers: { ...auth, origin } });
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.payload, { code: 'ACCESS_DENIED' });
    }
});

test('私有路由精确匹配 POST /internal/v1/st/sources，其它方法或路径不进入来源桥', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const body = { ownerAccountId: '101', chats: [{ chatIdentity: randomUUID() }] };
    assert.equal(SOURCE_BRIDGE_PATH, '/internal/v1/st/sources');
    for (const { method, target } of [{ method: 'GET', target: SOURCE_BRIDGE_PATH }, { method: 'POST', target: `${SOURCE_BRIDGE_PATH}/` }]) {
        const { res } = await call({ body, method, target, headers: auth });
        assert.equal(res.statusCode, 503); // 离线下落回会话准入流程，而非来源桥应答
        assert.equal(res.payload.code, 'VC_AUTH_UNAVAILABLE');
    }
});

test('账号映射隔离：A 账号读不到 B 账号的聊天快照，未映射账号被拒', async (t) => {
    const rootA = await tempRoot(t, 'vc-source-bridge-a-');
    const rootB = await tempRoot(t, 'vc-source-bridge-b-');
    const { call } = harness(t, [
        { accountId: '101', handle: 'ownerA', root: rootA },
        { accountId: '202', handle: 'ownerB', root: rootB },
    ]);
    const onlyA = await getF2Store(rootA).save(path.join(rootA, 'chats/card/only-a.jsonl'), chatRows(), { expected: fresh() });
    const onlyB = await getF2Store(rootB).save(path.join(rootB, 'chats/card/only-b.jsonl'), chatRows(), { expected: fresh() });

    const asA = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: onlyB.id }] }, headers: auth });
    assert.equal(asA.res.statusCode, 200);
    assert.deepEqual(snapshotOf(asA), [{ chatIdentity: onlyB.id, state: 'UNKNOWN' }]); // 不泄漏位置、版本或消息

    const asB = await call({ body: { ownerAccountId: '202', chats: [{ chatIdentity: onlyA.id }] }, headers: auth });
    assert.equal(asB.res.statusCode, 200);
    assert.deepEqual(snapshotOf(asB), [{ chatIdentity: onlyA.id, state: 'UNKNOWN' }]);

    const own = await call({ body: { ownerAccountId: '202', chats: [{ chatIdentity: onlyB.id }] }, headers: auth });
    assert.equal(snapshotOf(own)[0].state, 'PRESENT');
    assert.equal(snapshotOf(own)[0].messages.length, 2);

    const unmapped = await call({ body: { ownerAccountId: '999', chats: [{ chatIdentity: onlyB.id }] }, headers: auth });
    assert.equal(unmapped.res.statusCode, 403);
    assert.deepEqual(unmapped.res.payload, { code: 'ACCESS_DENIED' });
});

test('坏请求被拒：缺字段、畸形载体、非法身份、坏 revision 与重复 chat ID', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const goodId = randomUUID();
    const cases = [
        { body: undefined, status: 403, code: 'ACCESS_DENIED' }, // 无载体
        { body: '{"ownerAccountId":"101","chats":[{"chatIdentity":"', status: 403, code: 'ACCESS_DENIED' }, // 畸形 JSON 载体
        { body: { chats: [{ chatIdentity: goodId }] }, status: 403, code: 'ACCESS_DENIED' }, // 缺 ownerAccountId
        { body: { ownerAccountId: '0', chats: [{ chatIdentity: goodId }] }, status: 403, code: 'ACCESS_DENIED' },
        { body: { ownerAccountId: 101, chats: [{ chatIdentity: goodId }] }, status: 403, code: 'ACCESS_DENIED' }, // 非字符串 ID
        { body: { ownerAccountId: '101' }, status: 400, code: 'INVALID_REQUEST' }, // 缺 chats
        { body: { ownerAccountId: '101', chats: [] }, status: 400, code: 'INVALID_REQUEST' },
        { body: { ownerAccountId: '101', chats: 'not-an-array' }, status: 400, code: 'INVALID_REQUEST' },
        { body: { ownerAccountId: '101', chats: [{}] }, status: 400, code: 'INVALID_REQUEST' }, // 缺 chatIdentity
        { body: { ownerAccountId: '101', chats: [{ chatIdentity: 'not-a-uuid' }] }, status: 400, code: 'INVALID_REQUEST' },
        { body: { ownerAccountId: '101', chats: [{ chatIdentity: goodId, revision: -1 }] }, status: 400, code: 'INVALID_REQUEST' },
        { body: { ownerAccountId: '101', chats: [{ chatIdentity: goodId, revision: 1.5 }] }, status: 400, code: 'INVALID_REQUEST' },
        { body: { ownerAccountId: '101', chats: [{ chatIdentity: goodId }, { chatIdentity: goodId }] }, status: 400, code: 'INVALID_REQUEST' }, // 重复 chat ID
        { body: { ownerAccountId: '101', chats: Array.from({ length: 65 }, () => ({ chatIdentity: randomUUID() })) }, status: 400, code: 'INVALID_REQUEST' }, // 超过 64 项上限
    ];
    for (const { body, status, code } of cases) {
        const { res } = await call({ body, headers: auth });
        assert.equal(res.statusCode, status, `body=${JSON.stringify(body)}`);
        assert.deepEqual(res.payload, { code }, `body=${JSON.stringify(body)}`);
    }
});

test('成功快照返回 PRESENT 的消息内容、位置与版本并回显 ownerAccountId', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const base = await getF2Store(root).save(path.join(root, 'chats/card/main.jsonl'), chatRows(), { expected: fresh() });
    assert.equal(base.revision, 1);

    const { res } = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] }, headers: auth });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(res.payload).sort(), ['ownerAccountId', 'snapshots']);
    assert.equal(res.payload.ownerAccountId, '101');
    const [snapshot] = res.payload.snapshots;
    assert.equal(snapshot.chatIdentity, base.id);
    assert.equal(snapshot.state, 'PRESENT');
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.location, 'chats/card/main.jsonl');
    assert.equal('notModified' in snapshot, false);
    const rows = snapshot.messages;
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['candidateId', 'eligible', 'messageId', 'revision', 'role', 'settled', 'text']);
    assert.deepEqual(rows.map((row) => row.role), ['user', 'assistant']);
    assert.deepEqual(rows.map((row) => row.text), ['用户合成消息', '助手合成消息']);
    assert.deepEqual(rows.map((row) => row.eligible), [true, true]);
    assert.deepEqual(rows.map((row) => row.settled), [false, false]);
    for (const row of rows) {
        assert.match(row.messageId, uuidPattern);
        assert.match(row.candidateId, uuidPattern);
    }
});

test('同 revision 返回 notModified 且不带消息；落后 revision 返回完整快照', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const store = getF2Store(root);
    const file = path.join(root, 'chats/card/main.jsonl');
    const base = await store.save(file, chatRows(), { expected: fresh() });

    const hit = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: base.id, revision: 1 }] }, headers: auth });
    assert.equal(hit.res.statusCode, 200);
    assert.deepEqual(snapshotOf(hit), [{ chatIdentity: base.id, state: 'PRESENT', revision: 1, location: 'chats/card/main.jsonl', notModified: true }]);

    const second = await store.save(file, chatRows(['用户合成消息2', '助手合成消息2']), { expected: base });
    assert.equal(second.revision, 2);
    const stale = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: base.id, revision: 1 }] }, headers: auth });
    assert.equal('notModified' in snapshotOf(stale)[0], false);
    assert.equal(snapshotOf(stale)[0].revision, 2);
    assert.deepEqual(snapshotOf(stale)[0].messages.map((row) => row.text), ['用户合成消息2', '助手合成消息2']);
});

test('改名保持 chatIdentity，location 变化且 revision 推进', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const store = getF2Store(root);
    const file = path.join(root, 'chats/card/main.jsonl');
    const base = await store.save(file, chatRows(), { expected: fresh() });
    const renamed = await store.rename(file, path.join(root, 'chats/card/renamed.jsonl'), { expected: base });
    assert.equal(renamed.id, base.id);
    assert.equal(renamed.revision, 2);

    const { res } = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] }, headers: auth });
    assert.equal(res.statusCode, 200);
    const [snapshot] = res.payload.snapshots;
    assert.equal(snapshot.chatIdentity, base.id);
    assert.equal(snapshot.state, 'PRESENT');
    assert.equal(snapshot.revision, 2);
    assert.equal(snapshot.location, 'chats/card/renamed.jsonl');
    assert.notEqual(snapshot.location, 'chats/card/main.jsonl');
});

test('明确墓碑返回 DELETED 并携带删除版本', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const store = getF2Store(root);
    const file = path.join(root, 'chats/card/doomed.jsonl');
    const base = await store.save(file, chatRows(), { expected: fresh() });
    const gone = await store.remove(file, { expected: base });
    assert.equal(gone.revision, 2);

    const { res } = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] }, headers: auth });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.snapshots, [{ chatIdentity: base.id, state: 'DELETED', revision: gone.revision }]);
});

test('缺文件与坏 JSONL 返回 UNAVAILABLE 而非 DELETED', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const store = getF2Store(root);
    const missingFile = path.join(root, 'chats/card/missing.jsonl');
    const missing = await store.save(missingFile, chatRows(), { expected: fresh() });
    await fs.rm(missingFile); // 身份记录仍在，文件消失

    const brokenFile = path.join(root, 'chats/card/broken.jsonl');
    const broken = await store.save(brokenFile, chatRows(), { expected: fresh() });
    await fs.writeFile(brokenFile, '{不是 JSON\n');

    const { res } = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: missing.id }, { chatIdentity: broken.id }] }, headers: auth });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.snapshots, [
        { chatIdentity: missing.id, state: 'UNAVAILABLE' },
        { chatIdentity: broken.id, state: 'UNAVAILABLE' },
    ]);
});

test('未知 chatIdentity 返回 UNKNOWN，不泄漏位置或版本', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const known = await getF2Store(root).save(path.join(root, 'chats/card/main.jsonl'), chatRows(), { expected: fresh() });
    const unknown = randomUUID();

    const { res } = await call({ body: { ownerAccountId: '101', chats: [{ chatIdentity: unknown }, { chatIdentity: known.id }] }, headers: auth });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.snapshots[0], { chatIdentity: unknown, state: 'UNKNOWN' });
    assert.equal(res.payload.snapshots[1].state, 'PRESENT'); // 同一请求内逐项判定，顺序保持
});

test('浏览器 cookie 不构成授权：合成 vc_* cookie 无服务令牌仍被拒', async (t) => {
    const root = await tempRoot(t, 'vc-source-bridge-');
    const { call } = harness(t, [{ accountId: '101', handle: 'ownerA', root }]);
    const base = await getF2Store(root).save(path.join(root, 'chats/card/main.jsonl'), chatRows(), { expected: fresh() });
    const body = { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] };
    const cookie = 'vc_session=synthetic-session; vc_csrf=synthetic-csrf; vc_trusted_device=synthetic-device; st_session=not-vc';

    const cookieOnly = await call({ body, headers: { cookie } });
    assert.equal(cookieOnly.res.statusCode, 401);
    assert.deepEqual(cookieOnly.res.payload, { code: 'AUTHENTICATION_REQUIRED' });

    const cookieAndWrongToken = await call({ body, headers: { cookie, authorization: 'Bearer wrong-token' } });
    assert.equal(cookieAndWrongToken.res.statusCode, 401);
    assert.deepEqual(cookieAndWrongToken.res.payload, { code: 'AUTHENTICATION_REQUIRED' });

    // 服务令牌才是授权：cookie 存在与否不影响令牌请求的结果
    const withBoth = await call({ body, headers: { cookie, authorization: `Bearer ${SERVICE_TOKEN}` } });
    assert.equal(withBoth.res.statusCode, 200);
    assert.equal(withBoth.res.payload.snapshots[0].state, 'PRESENT');
});
