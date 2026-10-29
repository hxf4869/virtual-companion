const scenario = new URLSearchParams(location.search).get('scenario') || 'account';

const session = {
    accountId: '9007199254740993',
    sessionId: '11',
    authenticatorEnabled: true,
    deletionPending: false,
    role: 'ADMIN',
};
const sessionRows = scenario === 'account-empty' ? [] : [
    {
        id: '11', current: true, createdAt: '2026-10-28T02:00:00Z',
        accountId: '9007199254740993', role: 'ADMIN', passwordMustChange: false,
    },
    {
        id: '12', current: false, createdAt: '2026-10-28T03:00:00Z',
        accountId: '9007199254740993', role: 'ADMIN', passwordMustChange: false,
    },
];

function profile(key, name, ledgerPrice, pricing) {
    return {
        profileKey: key,
        modelId: key,
        displayName: name,
        contextWindowTokens: 8192,
        maxOutputTokens: 1024,
        state: 'ENABLED',
        priority: 1,
        pricing: pricing || {},
        ledgerPrice,
        boundPurposes: [],
    };
}

const activeModel = profile('usd', '美元价', 'ACTIVE', { currency: 'USD', inputPerMillionTokens: 1.5, outputPerMillionTokens: 3 });
const missingModel = profile('empty', '空价', 'MISSING', { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 });
const currencyModel = profile('cny', '人民币价', 'UNSUPPORTED_CURRENCY', { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 1 });
const resaveBefore = profile('empty', '空价', 'MISSING', {});
const resaveAfter = profile('empty', '空价', 'ACTIVE', { currency: 'USD', inputPerMillionTokens: 1.5, outputPerMillionTokens: 3 });

function provider(models, revision = 1) {
    return {
        providerId: 'w15-ledger',
        displayName: '计价样本',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: 'http://127.0.0.1:8743/v1',
        state: 'ENABLED',
        revision,
        credentialConfigured: true,
        models,
    };
}

const modelsByScenario = {
    'model-ledger-active': [activeModel],
    'model-ledger-missing': [missingModel],
    'model-ledger-currency': [currencyModel],
    'model-resave': [resaveBefore],
};

function pathname(url) {
    try { return new URL(String(url), location.origin).pathname; } catch { return String(url); }
}

let providerGets = 0;
window.fetch = async (url, init) => {
    const path = pathname(url);
    const method = String(init?.method || 'GET').toUpperCase();
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
    if (path.endsWith('/api/v1/auth/sessions') && method === 'GET') return json(sessionRows);
    if (path.endsWith('/api/v1/auth/session') && method === 'GET') return json(session);
    if (path.endsWith('/api/v1/admin/model-purposes') && method === 'GET') return json([]);
    if (path.endsWith('/api/v1/admin/providers') && method === 'GET') {
        providerGets += 1;
        window.__vcProviderGets = providerGets;
        if (scenario === 'model-resave' && providerGets > 1) return json([provider([resaveAfter], 2)]);
        return json([provider(modelsByScenario[scenario] || [activeModel])]);
    }
    if (method === 'PUT' && path.includes('/api/v1/admin/providers/')) {
        window.__vcPutBody = String(init?.body || '');
        window.__vcPutHasLedger = window.__vcPutBody.includes('ledgerPrice');
        return json({ ok: true, revision: 2 });
    }
    if (path.startsWith('/api')) return json({ code: 'HARNESS_BLOCKED' }, 599);
    throw new Error(`harness blocked ${path}`);
};

function waitFor(pred, timeout = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                if (pred()) resolve();
                else if (Date.now() - start > timeout) reject(new Error(`timeout ${scenario}`));
                else setTimeout(tick, 20);
            } catch (error) {
                reject(error);
            }
        };
        tick();
    });
}

const { mountModelSettings } = await import('../page.js');
const { mountDataRights } = await import('../data-rights.js');
const models = mountModelSettings();
const account = mountDataRights();

async function openAccount() {
    account.open(document.querySelector('#open-account'));
    await waitFor(() => {
        const text = document.querySelector('.vc-data-dialog')?.innerText || '';
        return text.includes('验证器已启用') && (text.includes('当前会话 ·') || text.includes('没有进行中的会话'));
    });
}

if (scenario.startsWith('account')) {
    await openAccount();
    if (scenario === 'account-partial') account.showExportState({ status: 'PARTIAL', exportId: '1' });
    if (scenario === 'account-delete') {
        account.showDeletionProgress({ status: 'PENDING', pendingDomains: ['ST', 'MEMORYCORE'] });
        await waitFor(() => {
            const visible = document.body.innerText;
            return visible.includes('账号删除未完成，聊天已暂停。') && visible.includes('ST、MEMORYCORE');
        });
    }
    if (scenario === 'account-reauth') {
        document.querySelector('[data-reset]').click();
        await waitFor(() => {
            const input = document.querySelector('[data-reauth-password]');
            return input && !input.closest('[hidden]') && document.activeElement === input && input.value === '';
        });
    }
    await waitFor(() => document.body.innerText.includes('备份状态独立，策略在 W16'));
}

if (scenario.startsWith('model')) {
    models.open(document.querySelector('#open-models'));
    await waitFor(() => document.querySelector('#vcms-f-display'));
    if (scenario === 'model-ledger-active') {
        await waitFor(() => {
            const name = document.querySelector('#vcms-m-display')?.value || '';
            const text = document.querySelector('.vcms-model-form')?.innerText || '';
            return name === '美元价' && !document.querySelector('#vcms-no-price') && !document.querySelector('#vcms-currency-price') && !text.includes('未配置单价：照常发送，费用记为未知') && !text.includes('非美元单价：照常发送，费用记为未知');
        });
    }
    if (scenario === 'model-ledger-missing') await waitFor(() => document.querySelector('#vcms-no-price')?.textContent.includes('未配置单价：照常发送，费用记为未知'));
    if (scenario === 'model-ledger-currency') await waitFor(() => document.querySelector('#vcms-currency-price')?.textContent.includes('非美元单价：照常发送，费用记为未知'));
    if (scenario === 'model-resave') {
        await waitFor(() => document.querySelector('#vcms-no-price'));
        const currency = document.querySelector('#vcms-m-currency');
        currency.value = 'USD';
        currency.dispatchEvent(new Event('change', { bubbles: true }));
        const pin = document.querySelector('#vcms-m-pin');
        pin.value = '1.5';
        pin.dispatchEvent(new Event('input', { bubbles: true }));
        const pout = document.querySelector('#vcms-m-pout');
        pout.value = '3';
        pout.dispatchEvent(new Event('input', { bubbles: true }));
        if (!document.querySelector('#vcms-no-price')) throw new Error('填写价格后提示被提前撤掉');
        if (document.querySelector('#vcms-save')?.disabled) throw new Error('补价后保存不可用');
        document.querySelector('#vcms-save').click();
        await waitFor(() => window.__vcProviderGets >= 2 && !document.querySelector('#vcms-no-price') && !document.querySelector('#vcms-currency-price'), 8000);
    }
}

window.__vcW15Ready = true;
