// V2-W03 · 扩展 api.js 会话上下文快照离线测试（Node --test，无 DOM / 无网络）。
// 对应 Go 防线（backend/internal/httpapi/core.go expectedAccountMatches /
// expectedSessionMatches：写请求缺失任一 Expected 头即 409）：
//   - 快照未取得前写请求就地失败（不发网络请求），错误形状固定；
//   - captureSessionContext 经桥 GET /api/v1/auth/session 取得十进制字符串快照并持有
//     （Go sessionIdentityJSON accountId / sessionId 均为字符串；accountId 可能超出
//     Number 安全整数——全程字符串，任何 Number() 往返都会破坏 2^53+1 值）；
//   - 此后所有写路径（PUT 供应商 / PUT 用途 / POST discover / POST reauth）
//     携带 X-VC-Expected-Account-ID / X-VC-Expected-Session-ID 且逐字符等于快照；
//   - 读路径（GET）不携带 Expected 头（Go 读路径无头仍放行）；
//   - 409 ACCOUNT_CONTEXT_CHANGED 分类为 context-changed，不与 revision 冲突混淆；
//   - 会话身份形状异常时拒绝捕获且不落半快照。
// 依赖模块级快照状态，用例按声明顺序串行执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ApiError,
    captureSessionContext,
    discoverProviderModels,
    fetchModelPurposes,
    fetchProviders,
    fetchRelationships,
    reauth,
    saveModelPurpose,
    saveProvider,
} from '../extension/vc-model-settings/api.js';

const BIG_ACCOUNT_ID = '9007199254740993'; // 2^53+1：Number() 往返会变成 9007199254740992
const SESSION_ID = '42';

const calls = [];
let router = () => ({ status: 200, body: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: { ...init.headers } });
    const res = router(calls.at(-1));
    return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => (res.rawBody ?? (res.body === undefined ? '' : JSON.stringify(res.body))),
    };
};
test.after(() => {
    globalThis.fetch = realFetch;
});

test('快照未取得前：写请求就地失败（context-changed），且不发任何网络请求', async () => {
    await assert.rejects(
        () => saveProvider('p1', { expectedRevision: 1 }),
        (err) => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.kind, 'context-changed');
            assert.equal(err.status, 0);
            assert.equal(err.code, 'VC_SESSION_CONTEXT_MISSING');
            return true;
        },
    );
    await assert.rejects(() => reauth('pw'), (err) => err instanceof ApiError && err.kind === 'context-changed');
    assert.equal(calls.length, 0, '缺快照时不得发出任何请求（发出去也必然被 Go 409 拒绝）');
});

test('captureSessionContext：经桥 GET /api/v1/auth/session，返回十进制字符串快照；读路径无 Expected 头', async () => {
    router = () => ({
        status: 200,
        body: { nextStep: 'ACTIVE', accountId: BIG_ACCOUNT_ID, sessionId: SESSION_ID, role: 'OWNER' },
    });
    const snap = await captureSessionContext();
    assert.equal(typeof snap.accountId, 'string');
    assert.equal(typeof snap.sessionId, 'string');
    assert.equal(snap.accountId, BIG_ACCOUNT_ID);
    assert.equal(snap.sessionId, SESSION_ID);
    const hit = calls.at(-1);
    assert.equal(hit.method, 'GET');
    assert.equal(hit.url, '/api/plugins/virtual-companion/go/api/v1/auth/session');
    assert.ok(!('X-VC-Expected-Account-ID' in hit.headers));
    assert.ok(!('X-VC-Expected-Session-ID' in hit.headers));
});

test('快照之后：PUT 供应商写请求两头齐全且逐字符等于快照（大整数不被数值化）', async () => {
    router = () => ({ status: 200, body: { ok: true, revision: 2 } });
    await saveProvider('p1', { expectedRevision: 1 });
    const hit = calls.at(-1);
    assert.equal(hit.method, 'PUT');
    assert.equal(hit.url, '/api/plugins/virtual-companion/go/api/v1/admin/providers/p1');
    assert.equal(hit.headers['X-VC-Expected-Account-ID'], BIG_ACCOUNT_ID);
    assert.equal(hit.headers['X-VC-Expected-Session-ID'], SESSION_ID);
    assert.equal(hit.headers['Content-Type'], 'application/json');
});

test('快照之后：其余写路径（用途 PUT / discover POST / reauth POST）同样携带两头', async () => {
    router = () => ({ status: 200, body: { ok: true } });
    await saveModelPurpose('FOREGROUND_CHAT', { state: 'ENABLED', expectedRevision: 3 });
    await discoverProviderModels('p1', { protocol: 'OPENAI_RESPONSES', baseUrl: 'https://api.example.com' });
    await reauth('pw');
    for (const hit of calls.slice(-3)) {
        assert.equal(hit.headers['X-VC-Expected-Account-ID'], BIG_ACCOUNT_ID, hit.url);
        assert.equal(hit.headers['X-VC-Expected-Session-ID'], SESSION_ID, hit.url);
    }
});

test('通用关系列表保留 personaRef，页面可据此选择范围而不丢失接口字段', async () => {
    router = () => ({ status: 200, body: [
        { relationshipId: 1, personaRef: 'gentle-listener', companionName: null },
        { relationshipId: 2, personaRef: 'st-character', companionName: '合成角色' },
        { relationshipId: 3, personaRef: 'st-character', companionName: null },
    ] });
    assert.deepEqual((await fetchRelationships()).map((row) => [row.relationshipId, row.personaRef]), [
        [1, 'gentle-listener'], [2, 'st-character'], [3, 'st-character'],
    ]);
});

test('读路径 GET providers / purposes 不携带 Expected 头', async () => {
    router = () => ({ status: 200, body: [] });
    await fetchProviders();
    await fetchModelPurposes();
    for (const hit of calls.slice(-2)) {
        assert.equal(hit.method, 'GET', hit.url);
        assert.ok(!('X-VC-Expected-Account-ID' in hit.headers), hit.url);
        assert.ok(!('X-VC-Expected-Session-ID' in hit.headers), hit.url);
    }
});

test('409 ACCOUNT_CONTEXT_CHANGED → context-changed（不与 revision 冲突混淆）', async () => {
    router = () => ({ status: 409, body: { code: 'ACCOUNT_CONTEXT_CHANGED', message: 'account context changed' } });
    await assert.rejects(
        () => saveProvider('p1', { expectedRevision: 1 }),
        (err) => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.kind, 'context-changed');
            assert.equal(err.status, 409);
            assert.equal(err.code, 'ACCOUNT_CONTEXT_CHANGED');
            return true;
        },
    );
});

test('宿主 HTML 403 提示显式重载，不要求密码、不刷新上下文或重放写入', async () => {
    router = () => ({ status: 403, rawBody: '<html><body>Forbidden</body></html>' });
    const before = calls.length;
    await assert.rejects(() => reauth('synthetic-password'), (err) => {
        assert.equal(err.kind, 'context-changed');
        assert.equal(err.code, 'VC_HOST_SESSION_EXPIRED');
        assert.equal(err.message, '页面验证已过期，请重新加载页面后再试。');
        assert.doesNotMatch(err.message, /密码/);
        return true;
    });
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).headers['X-VC-Expected-Session-ID'], SESSION_ID);
    router = () => ({ status: 403, body: { code: 'ACCESS_DENIED' } });
    await assert.rejects(() => reauth('synthetic-password'), (err) => err.kind === 'forbidden');
});

test('会话身份形状异常（数字 accountId 违反字符串契约）→ 拒绝捕获，旧快照不被半更新', async () => {
    router = () => ({ status: 200, body: { accountId: 9007199254740993, sessionId: '42' } });
    await assert.rejects(
        () => captureSessionContext(),
        (err) => err instanceof ApiError && err.code === 'VC_SESSION_CONTEXT_INVALID',
    );
    router = () => ({ status: 200, body: { ok: true } });
    await saveProvider('p1', { expectedRevision: 1 });
    assert.equal(calls.at(-1).headers['X-VC-Expected-Account-ID'], BIG_ACCOUNT_ID, '旧快照应原样保持');
});
