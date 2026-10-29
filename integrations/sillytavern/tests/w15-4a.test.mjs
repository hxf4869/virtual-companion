import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretUsageBudget, modelPriceMissing, NO_PRICE_COPY, BUDGET_COPY, budgetSignalFromGenerateBody, isGenerateRequestUrl } from '../extension/vc-model-settings/model-logic.js';
import {
    BACKUP_COPY, EXPORT_PARTIAL_COPY, RESTORE_LIMIT_COPY, authenticatorStatusText, deletionProgressText, otherSessions, sessionLabel,
} from '../extension/vc-model-settings/account-logic.js';
import { planOpenCreatedChat } from '../extension/vc-model-settings/instance-open.js';
import { mountChatShell } from '../extension/vc-model-settings/chat-shell.js';
import { mountDataRights } from '../extension/vc-model-settings/data-rights.js';
import { buttonByText, installMiniDom } from './mini-dom.mjs';

test('用量摘要不能当成预算不足；显式原因才关闭测试与发送', () => {
    assert.deepEqual(interpretUsageBudget({
        purposes: [{ purpose: 'FOREGROUND_CHAT', calls: 3, actualUsd: '1.25', estimatedUsd: '0.10' }],
    }), { known: false, insufficient: false });
    assert.deepEqual(interpretUsageBudget(null), { known: false, insufficient: false });
    assert.deepEqual(interpretUsageBudget({ budgetInsufficient: true }), { known: true, insufficient: true });
    assert.deepEqual(interpretUsageBudget({ reason: 'NO_BUDGET' }), { known: false, insufficient: false });
    assert.deepEqual(interpretUsageBudget({ details: { reason: 'OVER_LIMIT' } }), { known: true, insufficient: true });
    assert.equal(BUDGET_COPY.includes('设置仍可保存'), true);
    assert.deepEqual(budgetSignalFromGenerateBody({ error: { code: 'VC_USAGE_REFUSED', message: '本月额度已用完，本次生成未发送' } }), { reason: 'OVER_LIMIT' });
    assert.equal(budgetSignalFromGenerateBody({ error: { code: 'VC_USAGE_REFUSED', message: '未配置预算，本次生成未发送' } }), null);
    assert.equal(budgetSignalFromGenerateBody({ error: { code: 'VC_USAGE_REFUSED', message: '当前模型没有单价，本次生成未发送' } }), null);
    assert.equal(budgetSignalFromGenerateBody({ error: { code: 'VC_USAGE_REFUSED', reason: 'NO_PRICE', message: '本月额度已用完，本次生成未发送' } }), null);
    assert.deepEqual(budgetSignalFromGenerateBody({ error: { code: 'VC_USAGE_REFUSED', details: { reason: 'OVER_LIMIT' }, message: '其他' } }), { reason: 'OVER_LIMIT' });
    assert.equal(isGenerateRequestUrl('/api/backends/chat-completions/generate'), true);
    assert.equal(isGenerateRequestUrl('/api/backends/chat-completions/status'), false);
});

test('预算不足门禁对宿主发送控件标 aria-disabled，并拦住点击', async () => {
    const send = {
        id: 'send_but',
        disabled: false,
        title: '',
        attrs: {},
        setAttribute(key, value) { this.attrs[key] = String(value); },
        hasAttribute(key) { return Object.hasOwn(this.attrs, key); },
        removeAttribute(key) { delete this.attrs[key]; },
    };
    const listeners = [];
    const previous = globalThis.document;
    globalThis.document = {
        addEventListener(type, fn) { listeners.push({ type, fn }); },
        querySelector(sel) { return sel === '#send_but' ? send : null; },
        createElement() {
            const overlay = {
                innerHTML: '', hidden: true, querySelector: () => null, querySelectorAll: () => [],
                addEventListener() {},
            };
            return { querySelector: (sel) => (sel === '.vcms-overlay' ? overlay : null) };
        },
        body: { appendChild() {}, classList: { add() {}, remove() {} } },
    };
    try {
        const { mountModelSettings } = await import('../extension/vc-model-settings/page.js');
        const page = mountModelSettings();
        page.applyBudget({ reason: 'OVER_LIMIT' });
        assert.equal(send.disabled, true);
        assert.equal(send.attrs.role, 'button');
        assert.equal(send.attrs['aria-disabled'], 'true');
        assert.equal(send.hasAttribute('data-vc-budget-gate'), true);
        const blocked = { target: send, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
        listeners.find((item) => item.type === 'click').fn(blocked);
        assert.equal(blocked.stopped, true);
        page.applyBudget({});
        assert.equal(send.disabled, false);
        assert.equal(send.attrs.role, undefined);
        assert.equal(send.attrs['aria-disabled'], undefined);
        assert.equal(send.hasAttribute('data-vc-budget-gate'), false);
        const open = { target: send, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
        listeners.find((item) => item.type === 'click').fn(open);
        assert.equal(open.stopped, false);
    } finally {
        globalThis.document = previous;
    }
});

test('缺输入或输出单价仍可发送，费用文案不把未知价格当免费', () => {
    assert.equal(modelPriceMissing(null), true);
    assert.equal(modelPriceMissing({ currency: 'USD', inputPerMillionTokens: 1 }), true);
    assert.equal(modelPriceMissing({ currency: 'USD', outputPerMillionTokens: 2 }), true);
    assert.equal(modelPriceMissing({ inputPerMillionTokens: 0, outputPerMillionTokens: 0 }), false);
    assert.equal(NO_PRICE_COPY, '未配置单价：照常发送，费用记为未知');
});

test('账户状态只描述验证器、删除进度和备份，不生成密钥', () => {
    assert.equal(authenticatorStatusText({ authenticatorEnabled: true }), '验证器已启用');
    assert.equal(authenticatorStatusText({ authenticatorEnabled: false }), '验证器未启用');
    assert.equal(authenticatorStatusText({}), '验证器未启用');
    assert.match(deletionProgressText({ status: 'PENDING', pendingDomains: ['ST', 'MEMORYCORE'] }), /账号删除未完成/);
    assert.match(deletionProgressText({ status: 'PENDING', pendingDomains: ['ST', 'MEMORYCORE'] }), /ST、MEMORYCORE/);
    assert.equal(deletionProgressText({ status: 'PARTIAL' }).includes('部分完成'), false);
    assert.equal(EXPORT_PARTIAL_COPY, '部分完成');
    assert.equal(BACKUP_COPY, '备份状态独立，策略在 W16');
    assert.equal(RESTORE_LIMIT_COPY, '删除前的离线快照不能恢复为可用环境；恢复须先应用最新删除状态，具体策略在 W16。');
    const sessions = [
        { id: '9007199254740993', current: true },
        { id: '12', current: false },
        { id: '0', current: false },
    ];
    assert.deepEqual(otherSessions(sessions).map((item) => item.id), ['12']);
    assert.equal(sessionLabel(sessions[0]), '当前会话');
    assert.equal(sessionLabel(sessions[1]), '其他会话');
    assert.equal(JSON.stringify(sessions).includes('otpauth'), false);
});

test('数据页说明删除前快照不能恢复，导出处理中显示副本生成中', async () => {
    const document = installMiniDom();
    const realFetch = globalThis.fetch;
    const realFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
    globalThis.fetch = async () => new Response(JSON.stringify({
        accountId: '7', sessionId: '8', authenticatorEnabled: false,
    }), { status: 200 });
    let account;
    try {
        account = mountDataRights();
        account.open();
        await new Promise((resolve) => setTimeout(resolve, 0));
        account.showExportState({ status: 'PENDING', exportId: 'ex-1', errorMessage: 'ST_UNAVAILABLE' });
        const status = document.querySelector('[data-export-status]');
        assert.match(status.textContent, /聊天存储暂不可用，恢复后会继续生成/);
        assert.equal(status.textContent.includes('副本生成中'), false);
        account.showExportState({ status: 'PENDING', exportId: 'ex-1' });
        assert.match(status.textContent, /副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。/);
        assert.match(document.body.textContent, /删除前的离线快照不能恢复为可用环境/);
        assert.match(document.body.textContent, /恢复须先应用最新删除状态，具体策略在 W16/);
        assert.equal(/可恢复为可用环境/.test(document.body.textContent.replace('不能恢复为可用环境', '')), false);
        assert.match(document.body.textContent, new RegExp(RESTORE_LIMIT_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
        account?.close();
        globalThis.fetch = realFetch;
        if (realFrame) globalThis.requestAnimationFrame = realFrame;
        else delete globalThis.requestAnimationFrame;
    }
});

test('创建实例后只打开同一角色引用下、token 匹配的会话', () => {
    const characters = [
        { data: { extensions: { vc_character_ref: 'card-a' } } },
        { data: { extensions: { vc_character_ref: 'card-b' } } },
    ];
    const matched = planOpenCreatedChat({
        characters,
        characterRef: 'card-b',
        chatIdentity: 'chat-9',
        chats: [{ file: 'daily.jsonl', metadata: { vc_f2: { id: 'chat-9' } } }],
        currentMetadata: { vc_f2: { id: 'other', revision: 3 } },
    });
    assert.deepEqual(matched, { characterIndex: 1, file: 'daily.jsonl', writeToken: false });
    const fresh = planOpenCreatedChat({
        characters,
        characterRef: 'card-a',
        chatIdentity: 'chat-new',
        currentMetadata: {},
    });
    assert.deepEqual(fresh, { characterIndex: 0, file: '', writeToken: true });
    const occupied = planOpenCreatedChat({
        characters,
        characterRef: 'card-a',
        chatIdentity: 'chat-new',
        currentMetadata: { vc_f2: { id: 'already', revision: 2 } },
    });
    assert.equal(occupied.writeToken, false);
    assert.equal(occupied.file, '');
});

test('手机更多菜单用返回和 Escape 回到入口', () => {
    const document = installMiniDom();
    const opened = [];
    mountChatShell({
        getContext: () => ({
            groups: [], groupId: null, characters: [{ name: '澄夏' }], characterId: 0, chat: [],
            mainApi: 'openai', getChatCompletionModel: () => null,
            eventSource: { on() {} },
            eventTypes: { CHAT_CHANGED: 'chat', CHAT_COMPLETION_SETTINGS_READY: 'ready', SETTINGS_UPDATED: 'settings', OAI_PRESET_CHANGED_AFTER: 'preset' },
        }),
        openModels() { opened.push('模型'); },
        openInbox() { opened.push('主动陪伴'); },
        openStory() { opened.push('剧情'); },
        openAccount() { opened.push('账户'); },
        openMemory() { opened.push('记忆'); },
    });
    const labels = [...document.querySelectorAll('button')]
        .filter((button) => button.parent?.id === 'vc-chat-nav')
        .map((button) => button.getAttribute('data-nav'));
    assert.deepEqual(labels, ['chat', 'characters', 'memory', 'inbox', 'story', 'models', 'account', 'more']);
    const more = buttonByText(document, '更多');
    more.focus();
    more.click();
    const dialog = document.querySelector('#vc-chat-more');
    assert.equal(dialog.open, true);
    buttonByText(dialog, '主动陪伴').click();
    assert.deepEqual(opened, ['主动陪伴']);
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, more);
    more.click();
    dialog.dispatch('cancel');
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, more);
});
