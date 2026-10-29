const scenario = new URLSearchParams(location.search).get('scenario') || 'nav';

const session = {
    accountId: '9007199254740993',
    sessionId: '11',
    authenticatorEnabled: true,
    deletionPending: false,
    email: 'owner@example.test',
    role: 'ADMIN',
};
const sessions = [
    { id: '11', current: true, createdAt: '2026-10-28T02:00:00Z' },
    { id: '12', current: false, createdAt: '2026-10-28T03:00:00Z' },
];
const providers = [{
    providerId: 'local-synth',
    displayName: '本地合成服务',
    protocol: 'OPENAI_CHAT_COMPLETIONS',
    baseUrl: 'http://127.0.0.1:8743/v1',
    state: 'ENABLED',
    revision: 1,
    credentialConfigured: false,
    models: [
        {
            profileKey: 'noprice',
            modelId: 'synthetic-chat',
            displayName: '合成聊天',
            contextWindowTokens: 32768,
            maxOutputTokens: 2048,
            state: 'ENABLED',
            pricing: { currency: 'USD' },
        },
        {
            profileKey: 'priced',
            modelId: 'synthetic-priced',
            displayName: '已标价',
            contextWindowTokens: 8192,
            maxOutputTokens: 1024,
            state: 'ENABLED',
            pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        },
    ],
}];

function pathname(url) {
    try { return new URL(String(url), location.origin).pathname; } catch { return String(url); }
}

window.fetch = async (url) => {
    const path = pathname(url);
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
    if (path.endsWith('/api/v1/auth/sessions')) return json(sessions);
    if (path.endsWith('/api/v1/auth/session')) return json(session);
    if (path.endsWith('/api/v1/admin/providers')) return json(providers);
    if (path.endsWith('/api/v1/admin/model-purposes')) return json([]);
    if (path.includes('/api/v1/exports/')) return json({ status: 'PENDING', exportId: 'ex-1' });
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

const context = {
    groups: [],
    groupId: null,
    characters: [{ name: '澄夏' }],
    characterId: 0,
    chat: [],
    chatMetadata: {},
    mainApi: 'openai',
    getChatCompletionModel: () => null,
    eventSource: { on() {} },
    eventTypes: {
        CHAT_CHANGED: 'chat',
        CHAT_COMPLETION_SETTINGS_READY: 'ready',
        SETTINGS_UPDATED: 'settings',
        OAI_PRESET_CHANGED_AFTER: 'preset',
    },
};

const { mountChatShell } = await import('../chat-shell.js');
const { mountModelSettings } = await import('../page.js');
const { mountDataRights } = await import('../data-rights.js');

const models = mountModelSettings();
const account = mountDataRights();
mountChatShell({
    getContext: () => context,
    openModels: (opener) => { if (!models.isOpen()) models.open(opener); },
    openAccount: (opener) => account.open(opener),
    openInbox() {},
    openStory() {},
    openMemory() {},
    openCharacters() {},
});

const nav = (name) => document.querySelector(`#vc-chat-nav button[data-nav="${name}"]`);

if (scenario === 'more') {
    nav('more').click();
}
if (scenario.startsWith('model')) {
    nav('models').click();
    await waitFor(() => document.querySelector('#vcms-f-display') && document.querySelector('#vcms-no-price'));
    document.querySelector('details.vcms-advanced')?.setAttribute('open', '');
    if (scenario === 'model-budget') {
        models.applyBudget({ budgetInsufficient: true });
        await waitFor(() => document.querySelector('#vcms-budget'));
    }
}
if (scenario.startsWith('account')) {
    account.open(nav('account'));
    await waitFor(() => document.querySelector('.vc-data-dialog[open]'));
    if (scenario === 'account-partial') account.showExportState({ status: 'PARTIAL', exportId: '1' });
    if (scenario === 'account-pending') {
        account.showExportState({ status: 'PENDING', exportId: 'ex-1' });
        await waitFor(() => document.body.innerText.includes('副本生成中'));
    }
    if (scenario === 'account-delete') {
        account.showDeletionProgress({ status: 'PENDING', pendingDomains: ['ST', 'MEMORYCORE'] });
        await waitFor(() => {
            const visible = document.body.innerText;
            return visible.includes('账号删除未完成，聊天已暂停。') && visible.includes('ST、MEMORYCORE');
        });
    }
    await waitFor(() => document.body.innerText.includes('备份状态独立，策略在 W16'));
}

window.__vcW15Ready = true;
