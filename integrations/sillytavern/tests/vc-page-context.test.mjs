// V2-W03 · 模型设置页会话上下文变更（409 ACCOUNT_CONTEXT_CHANGED）离线测试。
// 用最小 DOM stub 驱动 page.js 控制器（node --test，无真 DOM / 无网络）：
//   - load 时经桥捕获会话快照（GET /api/v1/auth/session）；
//   - 保存命中 409 ACCOUNT_CONTEXT_CHANGED：草稿不丢、进入「显式重新加载」横幅态，
//     且写请求携带两头逐字符等于快照（大整数 accountId 字符串原样）；
//   - 「保留草稿，暂不重载」保留用户输入并收起横幅；
//   - 「重新加载页面数据」显式重载：重新捕获快照（再次 GET /api/v1/auth/session）并刷新目录。
import test from 'node:test';
import assert from 'node:assert/strict';

const BIG_ACCOUNT_ID = '9007199254740993'; // 2^53+1：Number() 往返会变成 9007199254740992

// ---------- fetch stub（桥 → Go） ----------

const calls = [];
let router = () => ({ status: 200, body: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: { ...init.headers } });
    const res = router(calls.at(-1));
    return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => (res.body === undefined ? '' : JSON.stringify(res.body)),
    };
};

// ---------- 最小 DOM stub ----------

function makeOverlay() {
    const listeners = new Map();
    return {
        innerHTML: '',
        hidden: false,
        isConnected: true,
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => true,
        addEventListener(type, fn) { listeners.set(type, fn); },
        dispatch(type, ev) { listeners.get(type)?.(ev); },
    };
}

globalThis.document = {
    cookie: '',
    addEventListener() {},
    querySelector() { return null; },
    createElement: () => {
        const overlay = makeOverlay();
        // page.js 只查询 .vcms-overlay 一个子节点；其余查询在 stub 下安全返回 null。
        return { ...makeOverlay(), querySelector: (sel) => (sel === '.vcms-overlay' ? overlay : null), _overlay: overlay };
    },
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
};

const { mountModelSettings } = await import('../extension/vc-model-settings/page.js');

// ---------- fixture ----------

const providersFixture = [{
    providerId: 'main-relay',
    displayName: '主中转',
    protocol: 'OPENAI_CHAT_COMPLETIONS',
    baseUrl: 'https://relay.example.com/v1',
    credentialConfigured: true,
    state: 'ENABLED',
    revision: 5,
    models: [{
        profileKey: 'daily-chat', modelId: 'vendor/daily-chat', displayName: '日常对话',
        contextWindowTokens: 128000, maxOutputTokens: 8192, state: 'ENABLED',
    }],
}];
const purposesFixture = [{
    purpose: 'FOREGROUND_CHAT', providerId: 'main-relay', profileKey: 'daily-chat',
    state: 'ENABLED', status: 'READY', revision: 3,
}];

function routeOk(hit) {
    if (hit.method === 'GET' && hit.url.endsWith('/api/v1/auth/session')) {
        return { status: 200, body: { nextStep: 'ACTIVE', accountId: BIG_ACCOUNT_ID, sessionId: '42', role: 'OWNER' } };
    }
    if (hit.method === 'GET' && hit.url.endsWith('/api/v1/admin/providers')) return { status: 200, body: providersFixture };
    if (hit.method === 'GET' && hit.url.endsWith('/api/v1/admin/model-purposes')) return { status: 200, body: purposesFixture };
    return { status: 200, body: { ok: true } };
}

async function until(cond, label) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(cond(), `timeout: ${label}`);
}

function clickAction(controller, action) {
    controller.root._overlay.dispatch('click', {
        target: { closest: () => ({ getAttribute: (n) => (n === 'data-action' ? action : null) }) },
    });
}

const sessionHits = () => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/api/v1/auth/session')).length;

test('409 ACCOUNT_CONTEXT_CHANGED：草稿保留、进入显式重载态、写请求两头齐全；重载动作重新捕获快照', async () => {
    router = routeOk;
    const controller = mountModelSettings();
    controller.open();
    await until(() => controller._state.phase === 'ready', '初次加载完成');
    assert.equal(controller._state.providers.length, 1);
    assert.equal(sessionHits(), 1, '页面加载时捕获一次会话快照');

    // 用户编辑草稿
    controller._state.draft.displayName = '我的修改';
    assert.equal(controller.isDirty(), true);

    // 保存被 Go 以 409 拒绝（账号/会话上下文变更）
    router = (hit) => (hit.method === 'PUT'
        ? { status: 409, body: { code: 'ACCOUNT_CONTEXT_CHANGED', message: 'account context changed' } }
        : routeOk(hit));
    clickAction(controller, 'save');
    await until(() => controller._state.contextChanged, '进入上下文变更提示态');

    const put = calls.find((c) => c.method === 'PUT');
    assert.ok(put, '应发出保存请求');
    assert.equal(put.headers['X-VC-Expected-Account-ID'], BIG_ACCOUNT_ID, '大整数 accountId 字符串原样');
    assert.equal(put.headers['X-VC-Expected-Session-ID'], '42');
    // 不丢草稿：仍是用户输入，未被刷新/清空；也不是 revision 冲突形态
    assert.equal(controller._state.draft.displayName, '我的修改');
    assert.equal(controller._state.phase, 'ready');
    assert.equal(controller._state.conflict, null);
    assert.ok(controller._state.contextChanged.includes('重新加载'));

    // 「保留草稿，暂不重载」：横幅收起，输入仍在
    clickAction(controller, 'context-keep');
    assert.equal(controller._state.contextChanged, null);
    assert.equal(controller._state.draft.displayName, '我的修改');

    // 再次保存仍 409 → 「重新加载页面数据」显式重载：重新捕获快照并刷新目录
    clickAction(controller, 'save');
    await until(() => controller._state.contextChanged, '再次进入上下文变更提示态');
    router = routeOk;
    clickAction(controller, 'context-reload');
    await until(() => controller._state.phase === 'ready' && !controller._state.contextChanged, '重载完成');
    assert.equal(sessionHits(), 2, '显式重载应重新捕获会话快照');
    assert.equal(controller._state.draft.displayName, '主中转', '重载后草稿回到最新目录内容');
});

test.after(() => {
    globalThis.fetch = realFetch;
    delete globalThis.document;
});
