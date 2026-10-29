import { mountChatShell } from '../chat-shell.js';
import { F2ConflictError, showF2Draft } from '../f2-client.js';
import { mountInstancePage } from '../instance-page.js';
import { BANNER_TEST_NOTE, bannerModel } from '../projection.js';

const scenario = new URLSearchParams(location.search).get('scenario') || 'empty';
const withMessages = scenario !== 'empty';
const prefs = {
    replyLength: 'MEDIUM', initiative: 'LOW', humor: 'LIGHT', advicePref: 'ASK_FIRST',
    remindersAllowed: false, memoryShareScope: 'RELATIONSHIP', avoidTopics: [], gender: 'NEUTRAL', avatarRef: 'AVATAR_NEUTRAL_01',
    userAddressAs: null,
};
const daily = { relationshipId: '11', personaRef: 'st-character', companionName: '澄夏·日常', active: true, ...prefs };
const trip = { relationshipId: '12', personaRef: 'st-character', companionName: '澄夏·旅行', active: false, ...prefs };
const listed = scenario === 'instance-list' || scenario === 'instance-unsaved' || scenario === 'instance-import-failed';

const context = {
    groups: [],
    groupId: null,
    characters: [{
        name: '澄夏',
        description: '沿湖散步',
        data: { extensions: { vc_character_ref: 'card-1' }, character_book: { name: '湖畔日常' } },
    }],
    characterId: 0,
    chat: withMessages ? [{ mes: '沿湖的风还停在上一句。', is_user: false }] : [],
    mainApi: 'openai',
    getChatCompletionModel: () => null,
    onlineStatus: scenario === 'offline' ? 'no_connection' : 'Valid',
    eventSource: { on() {} },
    eventTypes: {
        CHAT_CHANGED: 'chat', CHAT_COMPLETION_SETTINGS_READY: 'ready',
        SETTINGS_UPDATED: 'settings', OAI_PRESET_CHANGED_AFTER: 'preset',
        ONLINE_STATUS_CHANGED: 'online_status_changed',
    },
    chatMetadata: { vc_f2: { id: 'chat-a' }, vc_binding: { relationshipId: '11', mode: 'COMPANION' } },
};

function showBanner(reason) {
    const model = bannerModel({ decision: { eligible: false, reason } });
    const host = document.querySelector('#openai_api');
    const banner = document.createElement('div');
    banner.id = 'vc_foreground_banner';
    banner.className = `vcfg-banner vcfg-banner-${model.phase}`;
    const title = document.createElement('p');
    title.className = 'vcfg-banner-title';
    title.textContent = model.title;
    const detail = document.createElement('p');
    detail.className = 'vcfg-banner-detail';
    detail.textContent = model.detail;
    const meta = document.createElement('p');
    meta.className = 'vcfg-banner-meta';
    meta.textContent = BANNER_TEST_NOTE;
    const main = document.createElement('div');
    main.className = 'vcfg-banner-main';
    const copy = document.createElement('div');
    copy.append(title, detail, meta);
    main.append(copy);
    const actions = document.createElement('div');
    actions.className = 'vcfg-banner-actions';
    if (model.actions.includes('open-settings')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vcfg-banner-btn';
        button.textContent = '打开模型设置';
        actions.append(button);
    }
    banner.append(main, actions);
    host.append(banner);
}

if (scenario === 'model-pending') showBanner('binding-not-ready');
if (scenario === 'model-disabled') showBanner('model-disabled');
if (scenario === 'model-missing-key') showBanner('credential-missing');

if (withMessages) {
    const line = document.createElement('article');
    line.className = 'mes';
    line.textContent = '澄夏：沿湖的风还停在上一句。';
    document.querySelector('#chat').append(line);
}

const characters = mountInstancePage({
    loadRelationships: async () => (listed ? [daily, trip] : []),
    getCards: () => [{ characterRef: 'card-1', name: '澄夏', description: '沿湖散步', worldName: '湖畔日常' }],
    getBindings: () => (listed ? [
        { relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' },
        { relationshipId: '12', characterRef: 'card-1', chatIdentity: 'chat-b', mode: 'COMPANION' },
    ] : []),
    importCard: async () => { throw new Error('host rejected'); },
    createBinding: async (body) => ({ relationshipId: '12', conversationId: '22', ...body }),
    saveName: async () => { throw new Error('名称尚未保存'); },
});

const shell = mountChatShell({
    getContext: () => context,
    openModels() {},
    openCharacters(opener) { return characters.open(opener); },
});

if (scenario === 'inbox') {
    shell.setInboxEvents([
        { intent: 'BODY', stDelivered: false, linkStatus: 'present', conversationId: '20', relationshipId: '11', body: 'SECRET_BODY_SHOULD_NOT_RENDER' },
        { intent: 'BODY', stDelivered: false, linkStatus: 'present', conversationId: '20', relationshipId: '11', body: 'SECOND_SECRET_BODY' },
        { intent: 'WAITING_HOST', stDelivered: false, linkStatus: 'present', conversationId: '20', relationshipId: '11', body: null },
    ], { conversationId: '20' });
}
if (scenario === 'conflict') {
    let reloads = 0;
    window.__vcW15Reloads = () => reloads;
    window.SillyTavern = {
        getContext() {
            return {
                async reloadCurrentChat() {
                    reloads += 1;
                    context.chat = [{ mes: '最新版本没有这份未保存输入', is_user: false }];
                },
                get chat() { return context.chat; },
            };
        },
    };
    document.querySelector('#send_textarea').focus();
    showF2Draft(JSON.stringify({ mes: 'DRAFT_MARKER_91', token: 'secret-token' }), new F2ConflictError('VC_STALE_SOURCE'));
}

const role = [...document.querySelectorAll('#vc-chat-nav button')].find((button) => button.textContent.includes('角色'));
if (scenario.startsWith('instance')) {
    role.focus();
    await characters.open(role);
    if (scenario === 'instance-first') characters.page.startCreate();
    if (scenario === 'instance-import-failed') {
        await characters.page.importFile({ name: 'bad.txt', bytes: new TextEncoder().encode('SECRET_FILE not a card') });
    }
    if (scenario === 'instance-unsaved') characters.page.setName('澄夏·日常改');
}

document.body.dataset.scenario = scenario;
window.__vcW15Ready = true;
