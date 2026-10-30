// UI-PAGES 视觉验收：静默时段、二级页、阅读列、胶囊、提示条、抬起态与列表文案。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderInboxTab, renderInboxChannel, quietZoneValue } from '../extension/vc-model-settings/inbox-page.js';
import { createInboxPage } from '../extension/vc-model-settings/inbox-page.js';
import { renderMemoryTab, renderMemoryDetailTab } from '../extension/vc-model-settings/memory-page.js';
import { createMemoryPage } from '../extension/vc-model-settings/memory-page.js';
import { renderStoryTab } from '../extension/vc-model-settings/story-page.js';
import { renderCharactersTab } from '../extension/vc-model-settings/instance-page.js';
import { prepareLiftGhost } from '../extension/vc-model-settings/chat-view.js';
import { installMiniDom } from './mini-dom.mjs';

const root = new URL('../extension/vc-model-settings/', import.meta.url);

function inboxState() {
    const page = createInboxPage();
    Object.assign(page.state, {
        open: true,
        relationships: [{ relationshipId: '11', name: '澄夏' }],
        relationshipId: '11',
        policyDraft: {
            relationshipId: '11', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00',
            quietHoursTimezone: 'Asia/Shanghai', dailyLimit: 0, recentInteractionMinutes: 30,
            allowedModes: ['COMPANION'], offlineCapable: false,
        },
        channelDrafts: [{
            key: '7', channelId: '7', channel: 'EMAIL', exists: true, enabled: false,
            configuredTarget: '', previewBody: false, relationshipIds: [],
            credential: '', credentialMode: 'keep', credentialState: 'missing',
        }],
    });
    return page.state;
}

function memoryState(extra = {}) {
    const page = createMemoryPage();
    Object.assign(page.state, {
        open: true,
        relationships: [{ relationshipId: '11', companionName: '澄夏' }],
        relationshipId: '11',
        filters: { status: '' },
        filterDraft: { q: '', status: '', eventDateFrom: '', eventDateTo: '' },
        items: [],
    }, extra);
    return page.state;
}

test('静默时段是分组头，开始结束时区与每日上限同一行可见', () => {
    const html = renderInboxTab(inboxState());
    assert.match(html, /class="vc-group-title">静默时段</);
    assert.doesNotMatch(html, /vc-grow">静默时段/);
    assert.match(html, /placeholder="22:00"/);
    assert.match(html, /data-field="quietHoursStart"[^>]*value="22:00"/);
    assert.match(html, /data-field="quietHoursEnd"[^>]*value="07:00"/);
    assert.match(html, /data-zone="Asia\/Shanghai"/);
    assert.match(html, /value="中国标准时间"/);
    assert.match(html, /placeholder="中国标准时间"/);
    assert.match(html, /aria-label="每日上限"/);
    assert.equal(quietZoneValue('中国标准时间', 'Asia/Shanghai'), 'Asia/Shanghai');
    assert.equal(quietZoneValue('Asia/Tokyo', 'Asia/Shanghai'), 'Asia/Tokyo');
    assert.equal(quietZoneValue('', 'Asia/Shanghai'), '');
});

test('邮箱收件地址有右对齐占位，凭据不重复副标题', () => {
    const page = createInboxPage();
    page.state.relationships = [{ relationshipId: '11', name: '澄夏', mode: 'COMPANION' }];
    page.state.channelDrafts = [{
        key: '7', channelId: '7', channel: 'EMAIL', exists: false, enabled: false,
        configuredTarget: '', previewBody: false, relationshipIds: [],
        credential: '', credentialMode: 'keep', credentialState: 'missing',
    }];
    const email = renderInboxChannel(page.state, '7');
    assert.match(email, /aria-label="收件地址"[^>]*placeholder="未填写"/);
    assert.match(email, /class="vc-nav-title">邮箱/);
    assert.doesNotMatch(email, /vc-large-title">邮箱/);
    assert.doesNotMatch(email, /<span>凭据<\/span><span class="vc-meta">/);
});

test('发生日期是筛选菜单而不是孤立导航行', () => {
    const html = renderMemoryTab(memoryState());
    assert.match(html, /vc-grow">发生日期<\/span><span class="vc-value vc-select-value">全部/);
    assert.match(html, /#chevrons-up-down"/);
    assert.doesNotMatch(html, /vc-grow">发生日期<\/span><span class="vc-chevron">/);
    const ranged = renderMemoryTab(memoryState({
        filterDraft: { q: '', status: '', eventDateFrom: '2026-10-01', eventDateTo: '2026-10-30' },
    }));
    assert.match(ranged, /vc-select-value">2026-10-01 – 2026-10-30/);
});

test('记忆详情只出现一次来源已核验，状态行与分组分开', () => {
    const state = memoryState({
        view: 'detail',
        detail: {
            memoryId: '101', version: 1, summary: '用户把怀表放在旅店前台。', type: 'FACT', mode: 'DAILY',
            relationshipId: '11', lifecycle: 'ACTIVE', sourceStatus: 'VALID', recallEligible: false,
            time: { eventDate: '', recordedAt: '2026-10-30T07:27:00Z' },
            history: [], cleanup: { state: 'NONE' },
        },
        evidence: [{
            chatDisplayName: '原始聊天', messageId: 'm1', revision: 1, status: 'VALID',
            sourceTimestamp: '', sourceTimezone: '', excerpt: '',
        }],
    });
    const detail = renderMemoryDetailTab(state);
    assert.equal(detail.split('来源已核验').length - 1, 1);
    assert.match(detail, /class="vc-meta vc-memory-status"/);
});

test('无证物时不渲染证物小标题', () => {
    const stage = renderStoryTab({
        run: { caseId: 'rainy-inn-v1', stage: 'investigation' },
        view: {
            setting: '雨夜。', knownEvent: '', locations: [], knowledge: [],
            events: [{ line: '只有叙述。', worldVersion: 0 }],
            participants: [
                { actorId: 'player', name: '调查者', persona: '' },
                { actorId: 'lin', name: '林岚', persona: '掌柜' },
            ],
        },
        turn: { worldVersion: 1 }, actorId: '', busy: false, reason: '', notice: '',
        syncPending: false, configNote: '', error: '', companions: null, epilogue: '', rewindAsk: null,
    }, { view: 'stage' });
    assert.match(stage, /aria-label="线索"/);
    assert.doesNotMatch(stage, /vc-evi-label">证物/);
    assert.match(stage, /class="vc-story-say-row vc-field vc-composer-field vc-glass"/);
});

test('角色详情名字只留在导航，列表与详情有阅读列', () => {
    const detail = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: '' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1' });
    assert.match(detail, /class="vc-nav-title"[^>]*>澄夏</);
    assert.doesNotMatch(detail, /<b>澄夏<\/b>/);
    assert.match(detail, /class="vc-column"/);
    const list = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: '' }],
        relationships: [], bindings: [], selectedCharacterRef: '', selectedRelationshipId: '',
        creating: false, draftName: '', savedName: '', importError: '', loadError: '', nameError: '', unsaved: null,
    });
    assert.match(list, /class="vc-column"/);
    assert.match(list, /<b>澄夏<\/b>/);
});

test('抬起态只留正文卡并距左右 16px', () => {
    installMiniDom();
    const ghost = document.createElement('div');
    ghost.className = 'mes';
    ghost.innerHTML = '<div class="mesAvatarWrapper"><div class="avatar">头像</div></div><div class="mes_block"><div class="ch_name"><span class="timestamp">Oct 30</span></div><div class="mes_text">正文</div><div class="mes_buttons"><span class="swipe_left">左</span><span class="swipes-counter">1/1</span></div></div><div class="vc-mes-tools">工具</div>';
    prepareLiftGhost(ghost, { top: 120 }, 390);
    assert.equal(ghost.style.left, '16px');
    assert.equal(ghost.style.width, '358px');
    assert.equal(ghost.querySelector('.timestamp'), null);
    assert.equal(ghost.querySelector('.mes_buttons'), null);
    assert.equal(ghost.querySelector('.avatar'), null);
    assert.equal(ghost.querySelector('.vc-mes-tools'), null);
    assert.match(ghost.querySelector('.mes_text').textContent, /正文/);
});

test('主页面样式把二级页、玻璃胶囊和阅读列写进令牌', async () => {
    const shell = await readFile(new URL('shell.css', root), 'utf8');
    const chat = await readFile(new URL('chat-view.css', root), 'utf8');
    const story = await readFile(new URL('story.css', root), 'utf8');
    const inbox = await readFile(new URL('inbox.css', root), 'utf8');
    const instance = await readFile(new URL('instance.css', root), 'utf8');
    const memory = await readFile(new URL('memory.css', root), 'utf8');
    assert.match(shell, /:has\(\.vc-memory-tab\.is-detail\)[\s\S]*:has\(\.vc-characters\.is-detail\)[\s\S]*:has\(\.vc-inbox-tab\.is-detail\)[\s\S]*> \.vc-tabbar/);
    assert.match(shell, /\.vc-who \{[^}]*border-radius:\s*var\(--vc-radius-pill\)[^}]*backdrop-filter:\s*blur\(22px\) saturate\(180%\)/);
    assert.match(shell, /\[data-memory\]\s*\{[^}]*display:\s*none/);
    assert.match(shell, /#chat,\s*body\.vc-ui #sheld,\s*body\.vc-ui #send_form \{\s*border:\s*0 !important/);
    assert.match(chat, /#send_textarea \{[^}]*background:\s*var\(--vc-glass\) !important/);
    assert.match(chat, /#form_sheld::before \{\s*content:\s*none/);
    assert.match(chat, /align-items:\s*center;[\s\S]{0,120}height:\s*48px/);
    assert.match(chat, /top:\s*12px/);
    assert.match(story, /\.vc-story \{[^}]*width:\s*min\(100%, var\(--vc-read\)\)/);
    assert.match(story, /\.vc-send \{[^}]*width:\s*36px/);
    assert.match(inbox, /\.vc-cell input::placeholder \{[^}]*color:\s*var\(--vc-ink-2\)/);
    assert.match(inbox, /min-width:\s*7\.5rem/);
    assert.match(instance, /\.vc-characters \.vc-column \{[^}]*var\(--vc-list\)/);
    assert.match(instance, /\.vc-characters\.is-detail \.vc-column \{[^}]*var\(--vc-read\)/);
    assert.match(instance, /\.vc-role > \.vc-role-avatar \{[^}]*background:\s*var\(--vc-fill\)[^}]*color:\s*var\(--vc-ink\)/);
    assert.match(memory, /\.vc-memory-status \{[^}]*padding:\s*var\(--vc-space-xs\) 0/);
});
