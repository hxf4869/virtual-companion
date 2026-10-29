import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryPage, renderMemoryPage, renderMemoryTab, renderMemoryDetailTab, mountMemoryTab } from '../extension/vc-model-settings/memory-page.js';
import { createInboxPage, renderInboxPage, renderInboxTab, renderInboxChannel, mountInboxTab } from '../extension/vc-model-settings/inbox-page.js';

const root = fileURLToPath(new URL('../extension/vc-model-settings/', import.meta.url));

const memoryItem = (extra = {}) => ({
    memoryId: '101', version: 2, summary: '喜欢傍晚沿湖散步', type: 'PREFERENCE', mode: 'DAILY',
    relationshipId: '11', lifecycle: 'ACTIVE', sourceStatus: 'VALID', recallEligible: true,
    time: { eventDate: '2026-10-27', eventTime: null, eventTimezone: null, recordedAt: '2026-10-28T06:20:00Z' },
    history: [], cleanup: { state: 'NONE' }, ...extra,
});

function memoryState(extra = {}) {
    const page = createMemoryPage();
    Object.assign(page.state, {
        open: true,
        relationships: [
            { relationshipId: '11', companionName: '澄夏' },
            { relationshipId: '12', companionName: '澄夏' },
        ],
        relationshipId: '11',
        filters: { status: '' },
        filterDraft: { q: '', status: '', eventDateFrom: '', eventDateTo: '' },
        items: [memoryItem()],
    }, extra);
    return page.state;
}

function selectorsOf(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [];
    for (const match of text.matchAll(/([^{}]+)\{/g)) {
        const sel = match[1].trim();
        if (!sel || sel.startsWith('@')) continue;
        found.push(sel);
    }
    return found;
}

test('记忆新界面保留搜索、分段、状态与详情合同', () => {
    const html = renderMemoryTab(memoryState());
    assert.match(html, /aria-label="搜索记忆"/);
    assert.match(html, /placeholder="搜索记忆"/);
    assert.match(html, /data-vc-owned-title>记忆</);
    assert.match(html, /data-status=""[^>]*>全部</);
    assert.match(html, /data-status="PENDING_VERIFICATION"[^>]*>待核验</);
    assert.match(html, /data-status="INVALID"[^>]*>已失效</);
    assert.match(html, /id="vc-memory-instance"/);
    assert.match(html, /name="relationshipId"/);
    assert.match(html, /aria-label="角色实例"/);
    assert.match(html, /aria-label="记忆状态"/);
    assert.match(html, /data-memory-id="101"/);
    const row = html.slice(html.indexOf('<ul class="vc-memory-list">'), html.indexOf('</ul>'));
    assert.doesNotMatch(row, /生效中/);
    assert.doesNotMatch(row, /来源已核验/);
    assert.doesNotMatch(row, /偏好/);
    assert.match(html, /澄夏 · 日常 · /);
    assert.doesNotMatch(html, /澄夏 1 · 日常/);
    const rowOf = (source) => source.slice(source.indexOf('<ul class="vc-memory-list">'), source.indexOf('</ul>'));
    const pending = rowOf(renderMemoryTab(memoryState({
        items: [memoryItem({ memoryId: '102', sourceStatus: 'PENDING_VERIFICATION', summary: '待核验的合成记忆' })],
    })));
    assert.match(pending, /来源待核验/);
    assert.doesNotMatch(pending, /偏好/);
    const both = rowOf(renderMemoryTab(memoryState({
        items: [memoryItem({ lifecycle: 'FORGETTING', sourceStatus: 'INVALID', cleanup: { state: 'PENDING' } })],
    })));
    assert.match(both, /清理中/);
    assert.doesNotMatch(both, /来源已失效/);
    assert.doesNotMatch(html, /实例 11/);
    assert.match(html, /发生日期/);
    assert.doesNotMatch(html, /<img/);

    const escaped = renderMemoryTab(memoryState({
        items: [memoryItem({ summary: '<img src=x onerror=alert(1)>' })],
    }));
    assert.match(escaped, /&lt;img/);
    assert.doesNotMatch(escaped, /<img/);

    const loading = renderMemoryTab(memoryState({ loading: true, items: [] }));
    assert.match(loading, /role="status">正在加载记忆…/);
    const empty = renderMemoryTab(memoryState({ items: [] }));
    assert.match(empty, /没有找到记忆。试试其他关键词或筛选条件。/);
    assert.match(empty, /data-action="clear-filters"[^>]*>清除筛选/);
    assert.doesNotMatch(empty, /retry-list/);
    const unbound = renderMemoryTab(memoryState({ relationships: [], relationshipId: '', items: [] }));
    assert.match(unbound, /还没有角色实例，请先在聊天中绑定角色。/);
    const failed = renderMemoryTab(memoryState({ items: [], listError: '加载失败或操作未完成，请重试。' }));
    assert.match(failed, /role="alert">加载失败或操作未完成，请重试。/);
    assert.match(failed, /data-action="retry-list"/);
});

test('记忆详情保留来源、修订、纠正、删除与再验证合同', () => {
    const state = memoryState({
        view: 'detail',
        detail: memoryItem({
            history: [{ version: 1, lifecycle: 'ACTIVE', summary: '更早的合成记录', time: { recordedAt: '2026-10-01T00:00:00Z' } }],
        }),
        evidence: [{
            chatDisplayName: '湖边散步', messageId: 'm1', revision: 3, status: 'VALID',
            sourceTimestamp: '2026-10-27T10:00:00Z', sourceTimezone: 'Asia/Shanghai', excerpt: '喜欢散步',
        }],
    });
    const detail = renderMemoryDetailTab(state);
    assert.match(detail, /data-action="back"/);
    assert.match(detail, /aria-label="返回列表"/);
    assert.match(detail, /class="vc-nav-title">记忆详情</);
    assert.match(detail, /class="vc-memory-title"[^>]*>喜欢傍晚沿湖散步</);
    assert.match(detail, /aria-label="刷新详情"/);
    assert.doesNotMatch(detail, />刷新详情</);
    assert.match(detail, /<strong>修订 1<\/strong><span class="vc-meta">生效中 · /);
    assert.match(detail, /偏好/);
    assert.match(detail, /来源/);
    assert.match(detail, /修订历史/);
    assert.match(detail, /发生日期/);
    assert.match(detail, /记录时间/);
    assert.match(detail, /仅此角色实例/);
    assert.match(detail, /data-action="edit"[^>]*>纠正/);
    assert.match(detail, /data-action="confirm-forget"[^>]*>删除长期记忆/);
    assert.match(detail, /data-forget-dialog/);
    assert.match(detail, /聊天原文仍保留，可能继续用于当前对话。/);
    assert.match(detail, /将停止召回这条记忆并清理相关派生内容/);

    state.editing = true;
    state.draft = '改为早上散步';
    state.conflict = true;
    const editing = renderMemoryDetailTab(state);
    assert.match(editing, /id="vc-memory-draft"/);
    assert.match(editing, /改为早上散步/);
    assert.match(editing, /输入已保留/);
    assert.match(editing, /保存修订/);

    state.evidenceError = '来源加载失败，请刷新详情。';
    state.detail = memoryItem({ cleanup: { state: 'PENDING' } });
    state.editing = false;
    state.conflict = false;
    state.reauthAction = 'forget';
    const cleanup = renderMemoryDetailTab(state);
    assert.match(cleanup, /来源加载失败，请刷新详情。/);
    assert.match(cleanup, /清理中/);
    assert.match(cleanup, /data-reauth-dialog/);
    assert.match(cleanup, /重新验证身份/);
    assert.match(cleanup, /data-action="refresh-detail"/);
});

test('关闭 vc-ui 时挂载不改容器，旧记忆对话框仍是 select', () => {
    const previous = globalThis.document;
    const stored = globalThis.localStorage;
    const body = previous?.body;
    const hadClass = body?.classList?.contains?.('vc-ui') === true;
    let previousFlag;
    try { previousFlag = stored?.getItem?.('vc-ui'); } catch { previousFlag = undefined; }
    body?.classList?.remove?.('vc-ui');
    try { stored?.removeItem?.('vc-ui'); } catch { /* 存储不可用 */ }
    const container = {
        mutated: false,
        append() { this.mutated = true; },
        classList: { add() { this.mutated = true; } },
        setAttribute() { this.mutated = true; },
        replaceChildren() { this.mutated = true; },
    };
    try {
        const memory = mountMemoryTab(container);
        const inbox = mountInboxTab(container);
        assert.equal(memory.active, false);
        assert.equal(inbox.active, false);
        assert.equal(container.mutated, false);
        memory.refresh();
        inbox.refresh();
        memory.destroy();
        inbox.destroy();
        assert.equal(container.mutated, false);
    } finally {
        if (hadClass) body.classList.add('vc-ui');
        try {
            if (previousFlag == null) stored?.removeItem?.('vc-ui');
            else stored?.setItem?.('vc-ui', previousFlag);
        } catch { /* 存储不可用 */ }
        globalThis.document = previous;
    }
    const legacy = renderMemoryPage(memoryState());
    assert.match(legacy, /<select id="vc-memory-instance"/);
    assert.doesNotMatch(legacy, /data-vc-owned-title/);
});

test('陪伴新界面保留分段、开关、投递状态与渠道合同', () => {
    const page = createInboxPage();
    Object.assign(page.state, {
        open: true,
        relationships: [{ relationshipId: '11', name: '澄夏' }],
        relationshipId: '11',
        policyDraft: {
            relationshipId: '11', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00',
            quietHoursTimezone: 'Asia/Shanghai', dailyLimit: 3, recentInteractionMinutes: 30,
            allowedModes: ['COMPANION'], offlineCapable: false,
        },
        inbox: [{
            eventId: 'evt-1', relationshipId: '11', conversationId: '21', linkStatus: 'present',
            intent: 'BODY', body: '合成问候', stDelivered: false, read: false,
        }],
        deliveries: [{
            deliveryId: '31', eventId: 'evt-1', channel: 'EMAIL', configuredTarget: 'owner@example.test',
            status: 'accepted', stoppedReason: '',
        }],
        followUps: [{
            followUpId: '41', relationshipId: '11', status: 'SCHEDULED', eventId: 'evt-1',
            eventDate: '2026-10-30', body: '合成跟进', eventTime: '09:30', triggerAt: '2026-10-30T01:30:00Z',
        }],
        channelDrafts: [
            {
                key: '7', channelId: '7', channel: 'EMAIL', exists: true, enabled: true,
                configuredTarget: 'owner@example.test', previewBody: false, relationshipIds: ['11'],
                credential: 'super-secret-value', credentialMode: 'keep', credentialState: 'configured',
            },
            {
                key: '8', channelId: '8', channel: 'FEISHU', exists: true, enabled: false,
                configuredTarget: '合成群', previewBody: false, relationshipIds: ['11'],
                credential: '', credentialMode: 'keep', credentialState: 'withheld',
            },
        ],
    });
    const html = renderInboxTab(page.state);
    assert.match(html, /data-vc-owned-title>陪伴</);
    assert.match(html, /data-filter="all"/);
    assert.match(html, /data-filter="pending"/);
    assert.match(html, /data-filter="written"/);
    assert.match(html, /data-filter="broken"/);
    assert.match(html, />全部</);
    assert.match(html, />待写入</);
    assert.match(html, />已写入</);
    assert.match(html, />链接失效</);
    assert.match(html, /class="vc-inbox-switch vc-switch" role="switch" data-action="toggle-enabled" data-field="enabled" aria-checked="true" aria-pressed="true"/);
    assert.match(html, /主动问候<\/span>/);
    assert.match(html, /class="vc-inbox-badge"[^>]*>待写入</);
    assert.match(html, /邮箱 已接受/);
    assert.match(html, /渠道已接受</);
    assert.match(html, /vc-inbox-meta/);
    assert.match(html, /data-action="open-follow"/);
    assert.doesNotMatch(html, /vc-inbox-states/);
    assert.match(html, /邮箱<\/span><span class="vc-meta">已启用</);
    assert.doesNotMatch(html, /owner@example.test/);
    assert.match(html, /vc-inbox-summary/);
    assert.match(html, /静默时段/);
    assert.match(html, /aria-label="时区"/);
    assert.match(html, /aria-label="每日上限"/);
    assert.match(html, /data-action="ask-cancel"/);
    assert.match(html, /data-channel="EMAIL" data-preview="false"/);
    assert.match(html, /data-action="open-channel"/);
    assert.doesNotMatch(html, /super-secret-value/);
    assert.doesNotMatch(html, /手机已收到/);

    page.state.loading = true;
    page.state.relationships = [];
    page.state.inbox = [];
    assert.match(renderInboxTab(page.state), /role="status">正在加载/);

    const channel = renderInboxChannel(createInboxPage().state && page.state, '7');
    const restored = createInboxPage();
    Object.assign(restored.state, {
        relationships: [
            { relationshipId: '11', name: '澄夏', mode: 'COMPANION' },
            { relationshipId: '12', name: '澄夏', mode: 'STORY' },
        ],
        channelDrafts: page.state.channelDrafts,
    });
    const email = renderInboxChannel(restored.state, '7');
    const feishu = renderInboxChannel(restored.state, '8');
    assert.match(email, /aria-label="凭据"/);
    assert.match(email, /placeholder="已配置，留空不修改"/);
    assert.match(email, /data-channel-card/);
    assert.match(email, /data-key="7"/);
    assert.match(email, /data-action="toggle-preview" data-key="7" data-field="previewBody" aria-checked="false" aria-pressed="false"/);
    assert.match(email, /收件地址/);
    assert.doesNotMatch(email, /super-secret-value/);
    assert.match(feishu, /群名称/);
    assert.match(feishu, /群成员可见/);
    assert.match(feishu, /不回显/);
    assert.doesNotMatch(feishu, /vc-meta">不回显/);
    assert.match(feishu, /vc-meta">已配置</);
    assert.match(feishu, /澄夏 · 日常/);
    assert.match(feishu, /澄夏 · 剧情/);
    assert.match(feishu, /data-action="toggle-relationship"/);
    assert.match(email, /role="switch"/);
    assert.equal(channel.includes('凭据') || email.includes('凭据'), true);

    const legacy = createInboxPage();
    legacy.state.policyDraft = {
        ...legacy.state.policyDraft,
        enabled: true,
        allowedModes: ['COMPANION'],
    };
    const oldHtml = renderInboxPage(legacy.state);
    assert.match(oldHtml, /<h1[^>]*>主动陪伴<\/h1>/);
    assert.match(oldHtml, /class="vc-inbox-switch" role="switch" data-action="toggle-enabled" data-field="enabled" aria-checked="true" aria-pressed="true"/);
    assert.doesNotMatch(oldHtml, /data-vc-owned-title/);
});

test('新样式只写在 body.vc-ui 下，旧陪伴样式标记仍在', async () => {
    const memoryCss = await readFile(path.join(root, 'memory.css'), 'utf8');
    const inboxCss = await readFile(path.join(root, 'inbox.css'), 'utf8');
    const index = await readFile(path.join(root, 'index.js'), 'utf8');
    for (const sel of selectorsOf(memoryCss)) {
        for (const part of sel.split(',')) assert.match(part.trim(), /^body\.vc-ui\b/, part);
    }
    assert.doesNotMatch(memoryCss, /#[0-9a-fA-F]{3,8}\b/);
    const start = inboxCss.indexOf('/* vc-ui: begin */');
    const end = inboxCss.indexOf('/* vc-ui: end */');
    assert.ok(start >= 0 && end > start);
    const region = inboxCss.slice(start, end);
    for (const sel of selectorsOf(region)) {
        for (const part of sel.split(',')) assert.match(part.trim(), /^body\.vc-ui\b/, part);
    }
    assert.doesNotMatch(region, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(inboxCss, /--SmartThemeBlurTintColor/);
    assert.match(inboxCss, /--SmartThemeBodyColor/);
    assert.match(inboxCss, /#14181F/);
    assert.match(inboxCss, /#9AB9FF/);
    assert.match(index, /export \{ mountMemoryTab \} from '\.\/memory-page\.js'/);
    assert.match(index, /export \{ mountInboxTab \} from '\.\/inbox-page\.js'/);
});

test('陪伴空列表不显示重试，失败才重试，空跟进留在分组里', () => {
    const page = createInboxPage();
    page.state.open = true;
    const empty = renderInboxTab(page.state);
    assert.match(empty, /role="status">没有消息</);
    assert.doesNotMatch(empty, /data-action="retry-open"/);
    assert.match(empty, /<div class="vc-group"><div class="vc-cell" role="status">没有跟进<\/div><\/div>/);
    page.state.error = '加载失败，请重试。';
    page.state.inbox = [];
    const failed = renderInboxTab(page.state);
    assert.match(failed, /data-action="retry-open">重试</);
});
