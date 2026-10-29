// F4b：vc-ui 开启时的角色页与剧情页渲染合同。不改旧对话框输出，不启浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UNSAVED_INSTANCE_COPY, renderInstancePage, renderCharactersTab, mountCharactersTab } from '../extension/vc-model-settings/instance-page.js';
import { STORY_SYNC_PENDING, renderStoryPage, renderStoryTab, mountStoryTab } from '../extension/vc-model-settings/story-page.js';

const prefs = {
    replyLength: 'MEDIUM', initiative: 'LOW', humor: 'LIGHT', advicePref: 'ASK_FIRST',
    remindersAllowed: false, memoryShareScope: 'RELATIONSHIP', avoidTopics: [], gender: 'NEUTRAL', avatarRef: 'AVATAR_NEUTRAL_01',
    userAddressAs: null,
};

function baseCharacters(extra = {}) {
    return {
        cards: [
            { characterRef: 'card-1', name: '澄夏', description: '沿湖散步', worldName: '湖畔日常', avatar: '' },
            { characterRef: 'card-2', name: '林岚', description: '', worldName: '', avatar: '' },
        ],
        relationships: [
            { relationshipId: '11', personaRef: 'st-character', companionName: '澄夏·日常', characterRef: 'card-1', lastChatAt: '2026-10-29T10:30:00', ...prefs },
            { relationshipId: '12', personaRef: 'st-character', companionName: '澄夏·旅行', characterRef: 'card-1', ...prefs },
            { relationshipId: '21', personaRef: 'st-character', companionName: '林岚·夜班', characterRef: 'card-2', ...prefs },
        ],
        bindings: [
            { relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' },
            { relationshipId: '12', characterRef: 'card-1', chatIdentity: 'chat-b', mode: 'COMPANION' },
            { relationshipId: '21', characterRef: 'card-2', chatIdentity: 'chat-c', mode: 'COMPANION' },
        ],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '11',
        creating: false,
        draftName: '澄夏·日常',
        savedName: '澄夏·日常',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
        ...extra,
    };
}

function playing(extra = {}) {
    return {
        run: { caseId: 'rainy-inn-v1', stage: 'investigation' },
        view: {
            setting: '雨夜，小旅馆的展柜怀表失踪。',
            knownEvent: '20:20 老板发现怀表不见了。',
            locations: ['大堂', '厨房'],
            knowledge: ['大堂展柜是空的'],
            events: [{ line: '林岚出示了借用记录', clueName: '钥匙借用记录', worldVersion: 0, worldEventId: '31' }],
            participants: [
                { actorId: 'player', name: '调查者', persona: '' },
                { actorId: 'lin', name: '林岚', persona: '旅馆掌柜' },
                { actorId: 'su', name: '苏禾', persona: '当晚在大堂' },
                { actorId: 'zhou', name: '周澈', persona: '住店维修工' },
            ],
        },
        turn: { worldVersion: 1 },
        actorId: 'lin',
        busy: false,
        reason: '',
        notice: '',
        syncPending: false,
        configNote: '',
        error: '',
        companions: null,
        epilogue: '',
        rewindAsk: null,
        ...extra,
    };
}

test('关闭 vc-ui 时角色与剧情挂载不创建新界面', async () => {
    const characters = mountCharactersTab(null, { onOpenInstance() {} });
    const story = mountStoryTab(null, {});
    await characters.refresh();
    await story.refresh();
    characters.destroy();
    story.destroy();
});

test('角色网格、空状态、加载、错误与详情保留 data-action', () => {
    const grid = renderCharactersTab(baseCharacters());
    assert.match(grid, /aria-label="导入角色卡"/);
    assert.match(grid, /data-action="import"/);
    assert.match(grid, /data-action="select-template"/);
    assert.match(grid, /data-ref="card-1"/);
    assert.match(grid, /2 个实例/);
    assert.match(grid, /1 个实例/);
    assert.equal(grid.includes('PRIVATE_'), false);
    assert.equal(grid.includes('GM_ONLY_'), false);

    const empty = renderCharactersTab(baseCharacters({ cards: [], relationships: [], bindings: [] }));
    assert.match(empty, /还没有角色卡模板/);
    assert.match(empty, /data-action="import"/);

    const loading = renderCharactersTab(baseCharacters(), { loading: true });
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /vc-skeleton/);

    const failed = renderCharactersTab(baseCharacters({ loadError: '加载失败，请重试。' }));
    assert.match(failed, /role="alert"/);
    assert.match(failed, /加载失败，请重试。/);
    assert.match(failed, /data-action="retry"/);

    const detail = renderCharactersTab(baseCharacters({ draftName: '改过', savedName: '澄夏·日常' }), { screen: 'detail', detailRef: 'card-1' });
    assert.match(detail, /aria-label="返回"/);
    assert.match(detail, /data-action="edit-card"/);
    assert.match(detail, /aria-label="编辑角色卡"/);
    assert.match(detail, /关联世界书 · 湖畔日常/);
    assert.match(detail, /data-action="select-instance"/);
    assert.match(detail, /data-id="11"/);
    assert.match(detail, /name="displayName"/);
    assert.match(detail, new RegExp(UNSAVED_INSTANCE_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(detail, /data-action="cancel-edit"/);
    assert.equal(detail.includes('<澄夏>'), false);
});

test('未归属实例在多张卡时单独成组，单张卡时并入该卡', () => {
    const loose = renderCharactersTab(baseCharacters({
        relationships: [{ relationshipId: '99', personaRef: 'st-character', companionName: '未归属', ...prefs }],
        bindings: [],
    }));
    assert.match(loose, /aria-label="陪伴实例"/);
    assert.match(loose, /未归属/);
    assert.match(loose, /data-action="select-instance"/);

    const folded = renderCharactersTab(baseCharacters({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: '' }],
        relationships: [{ relationshipId: '99', personaRef: 'st-character', companionName: '未归属', ...prefs }],
        bindings: [],
    }));
    assert.match(folded, /1 个实例/);
    assert.equal(folded.includes('aria-label="陪伴实例"'), false);
});

test('旧角色对话框渲染仍然输出模板与实例合同', () => {
    const html = renderInstancePage(baseCharacters());
    assert.match(html, /角色卡模板/);
    assert.match(html, /陪伴实例/);
    assert.match(html, /data-action="import"/);
    assert.match(html, /data-action="close"/);
    assert.match(html, /vc-instance-page/);
});

test('剧情案件卡、舞台、生成、证物、拒绝、结局与同步保留状态合同', () => {
    const gate = renderStoryTab({
        run: null, view: null, busy: false, error: '开局未完成，请重试。',
        configNote: '剧情导演或 NPC 尚未绑定可用模型。', reason: '', notice: '',
    });
    assert.match(gate, /data-state="unstarted"/);
    assert.match(gate, /雨夜旅馆：失踪的怀表/);
    assert.match(gate, /data-action="start"/);
    assert.match(gate, /开局/);
    assert.match(gate, /data-action="configure"/);
    assert.match(gate, /打开模型设置/);
    assert.match(gate, /role="alert"/);
    assert.match(gate, /开局未完成，请重试。/);
    assert.equal(gate.includes('data-world-version'), false);

    const loading = renderStoryTab(playing(), { loading: true });
    assert.match(loading, /aria-busy="true"/);
    assert.equal(loading.includes('data-action="start"'), false);

    const stage = renderStoryTab(playing(), { view: 'stage', draftSay: '' });
    assert.match(stage, /data-state="playing"/);
    assert.match(stage, /data-world-version="1"/);
    assert.match(stage, /data-action="close"/);
    assert.match(stage, /aria-label="离开剧情"/);
    assert.match(stage, /data-action="ask-rewind"/);
    assert.match(stage, /aria-label="回档"/);
    assert.match(stage, /data-action="select-actor"/);
    assert.match(stage, /data-actor="lin"/);
    assert.match(stage, /aria-label="林岚，旅馆掌柜"/);
    assert.match(stage, /aria-pressed="true"/);
    assert.equal(stage.includes('>当前<'), false);
    assert.equal(stage.includes('vc-npc-persona'), false);
    assert.match(stage, /data-step="a1"/);
    assert.match(stage, /data-step="a2" hidden/);
    assert.match(stage, /data-step="a7"[^>]*hidden/);
    assert.match(stage, /vc-btn-danger/);
    assert.match(stage, /class="vc-dock vc-glass"/);
    assert.match(stage, /aria-label="陪伴"/);
    assert.match(stage, /data-action="show-companions"/);
    assert.match(stage, /aria-label="公开设定"/);
    assert.match(stage, /aria-label="地点"/);
    assert.match(stage, /aria-label="公开时间线"/);
    assert.match(stage, /aria-label="线索"/);
    assert.match(stage, /data-action="act"/);
    assert.match(stage, /data-step="a1"/);
    assert.match(stage, /data-field="say"/);
    assert.match(stage, /aria-label="对所选角色说"/);
    assert.match(stage, /data-action="say"/);
    assert.match(stage, /aria-label="发送"/);
    assert.equal(stage.includes('PRIVATE_'), false);
    assert.equal(stage.includes('GM_ONLY_'), false);

    const thinking = renderStoryTab(playing({ busy: true }), { view: 'stage' });
    assert.match(thinking, /data-state="generating"/);
    assert.match(thinking, /正在生成这一步/);
    assert.match(thinking, /data-action="stop"/);
    assert.match(thinking, /aria-label="停止"/);

    const evidence = renderStoryTab(playing({ notice: '发现证据：钥匙借用记录' }), { view: 'stage', fresh: true });
    assert.match(evidence, /data-state="evidence"/);
    assert.match(evidence, /data-evidence="show"/);
    assert.match(evidence, /class="vc-evi is-back"/);
    assert.match(evidence, /vc-stream/);

    const rejected = renderStoryTab(playing({ reason: '这步行动没有生效，世界没有变化。' }), { view: 'stage' });
    assert.match(rejected, /data-state="rejected"/);
    assert.match(rejected, /class="vc-note vc-glass" role="alert"/);

    const conflict = renderStoryTab(playing({ reason: '这步行动与当前进度不一致，没有另开分支。' }), { view: 'stage' });
    assert.match(conflict, /data-state="conflict"/);

    const ended = renderStoryTab(playing({ run: { caseId: 'rainy-inn-v1', stage: 'resolved' } }), { view: 'stage', draftSummary: '' });
    assert.match(ended, /data-state="ended"/);
    assert.match(ended, /vc-group vc-story-ending/);
    assert.match(ended, /结局/);
    assert.match(ended, /data-field="summary"/);
    assert.match(ended, /aria-label="共同游玩摘要"/);
    assert.match(ended, /data-action="save-epilogue"/);
    assert.match(ended, /data-action="discard-epilogue"/);

    const sync = renderStoryTab(playing({ syncPending: true }), { view: 'stage' });
    assert.match(sync, new RegExp(STORY_SYNC_PENDING));
    assert.match(sync, /vc-note vc-glass vc-story-sync" role="status"/);
});

test('没有局时不进入舞台，旧剧情对话框合同仍在', () => {
    const html = renderStoryTab(playing(), { view: 'stage' });
    assert.match(html, /data-state="playing"/);
    const blocked = renderStoryTab({ run: null, view: null, busy: false, error: '', configNote: '', reason: '', notice: '' }, { view: 'stage' });
    assert.match(blocked, /data-state="unstarted"/);
    assert.match(blocked, /data-action="start"/);
    const legacy = renderStoryPage({
        run: null, view: null, busy: false, error: '', configNote: '', reason: '', notice: '',
    });
    assert.match(legacy, /data-state="unstarted"/);
    assert.match(legacy, /data-action="start"/);
    assert.match(legacy, /data-action="close"/);
    assert.match(legacy, /雨夜旅馆/);
});

test('新样式挂在 body.vc-ui 下，旧色值与窄屏规则仍在', async () => {
    const storyCss = await readFile(new URL('../extension/vc-model-settings/story.css', import.meta.url), 'utf8');
    const instanceCss = await readFile(new URL('../extension/vc-model-settings/instance.css', import.meta.url), 'utf8');
    for (const css of [storyCss, instanceCss]) {
        assert.match(css, /#14181F/);
        assert.match(css, /#9AB9FF/);
        assert.match(css, /--SmartThemeBlurTintColor/);
        assert.match(css, /--SmartThemeBodyColor/);
    }
    assert.match(storyCss, /@media \(max-width: 760px\)/);
    assert.match(storyCss, /grid-template-columns:\s*1fr/);
    assert.match(storyCss, /body\.vc-ui \.vc-story-tab/);
    assert.match(instanceCss, /body\.vc-ui \.vc-characters/);
    assert.match(instanceCss, /72px/);
    const index = await readFile(new URL('../extension/vc-model-settings/index.js', import.meta.url), 'utf8');
    assert.match(index, /export \{ mountCharactersTab \} from '\.\/instance-page\.js'/);
    assert.match(index, /export \{ mountStoryTab \} from '\.\/story-page\.js'/);
    assert.match(index, /mountStoryPage/);
    assert.equal(index.split('enableVcUi();').length - 1, 1);
    const storySource = await readFile(new URL('../extension/vc-model-settings/story-page.js', import.meta.url), 'utf8');
    assert.match(storySource, /const STAGE_MOTION = \{/);
    assert.equal(storySource.includes('duration: 900'), false);
    assert.equal(storySource.includes('duration: 1600'), false);
    assert.equal(storySource.includes('duration: 800'), false);
    assert.equal(storyCss.includes('.vc-characters .vc-btn'), false);
    assert.equal(storyCss.includes('min-height: var(--vc-touch);\n    height: auto'), false);
    assert.equal(instanceCss.includes('.vc-characters .vc-btn {'), false);
});
