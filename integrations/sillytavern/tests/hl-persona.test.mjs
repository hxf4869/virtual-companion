import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installInstanceBinding } from '../extension/vc-model-settings/f2-client.js';
import { bindingCoalesceKey, coalesceBinding, resetBindingCoalesce } from '../extension/vc-model-settings/instance-binding.js';
import {
    DEFAULT_GLOBAL_RULES,
    MES_EXAMPLE,
    STYLE_NOTE,
    buildCharacterCard,
    moodGuidance,
    pronounFor,
    readGlobalRules,
    restoreDefaultRules,
} from '../extension/vc-model-settings/persona.js';
import { injectCompanionPrompt } from '../extension/vc-model-settings/companion-prompt.js';
import { finishOnboarding, renderOnboarding, shouldOfferOnboarding } from '../extension/vc-model-settings/onboarding.js';
import { proactivePolicyPayload, readProactivePolicy, renderInboxTab } from '../extension/vc-model-settings/inbox-page.js';
import { renderCharactersTab } from '../extension/vc-model-settings/instance-page.js';

const ALL_STYLES = ['口语短句，偶尔表情', '幽默会接梗', '好奇你的生活', '分享自己的日常'];

function deferred() {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    return { promise, resolve };
}

test('同一聊天 0.5 秒内绑定两次只向服务端解析一次', async () => {
    resetBindingCoalesce();
    const handlers = [];
    const metadata = { vc_f2: { id: 'id-1', revision: 0 } };
    const context = {
        characters: [{ name: '小满', data: { extensions: { vc_character_ref: 'card' } } }],
        characterId: 0,
        groupId: null,
        chatId: 'main.jsonl',
        chatMetadata: metadata,
        chat: [],
        eventSource: { on(_type, fn) { handlers.push(fn); } },
        eventTypes: { CHAT_CHANGED: 'chat_changed' },
        saveChat: async () => {},
    };
    const gate = deferred();
    let calls = 0;
    const identities = [];
    const pending = installInstanceBinding({
        getContext: () => context,
        resolveBinding: async (snapshot) => {
            calls += 1;
            identities.push(snapshot.chatIdentity);
            await gate.promise;
            return {
                relationshipId: '7',
                conversationId: '8',
                chatIdentity: snapshot.chatIdentity,
                characterRef: snapshot.characterRef,
                mode: snapshot.mode,
            };
        },
        writeExtensionField: async () => { throw new Error('should not write ref'); },
        captureSessionContext: async () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    metadata.vc_f2 = { id: 'id-2', revision: 0 };
    handlers[0]();
    gate.resolve();
    await pending;
    assert.equal(calls, 1);
    assert.equal(identities[0], 'id-1');
    assert.equal(context.chatMetadata.vc_binding.relationshipId, '7');
    assert.equal(bindingCoalesceKey({ characterRef: 'card', mode: 'COMPANION', chatIdentity: 'id-2' }), bindingCoalesceKey({ characterRef: 'card', mode: 'COMPANION', chatIdentity: 'id-1' }));
});

test('未绑定的合并结果超过 0.5 秒后重新解析', async () => {
    resetBindingCoalesce();
    let calls = 0;
    let now = 0;
    const clock = () => now;
    const run = () => coalesceBinding('new:COMPANION:card', async () => {
        calls += 1;
        return calls;
    }, clock);
    assert.equal(await run(), 1);
    now = 499;
    assert.equal(await run(), 1);
    now = 500;
    assert.equal(await run(), 2);
});

test('人设模板按文案拼成 Character Card V2', () => {
    const card = buildCharacterCard({ name: '小满', relation: '好朋友', gender: '女生', styles: ALL_STYLES });
    assert.equal(card.spec, 'chara_card_v2');
    assert.equal(card.spec_version, '2.0');
    assert.equal(card.name, '小满');
    assert.equal(card.data.name, '小满');
    assert.equal(card.description, '小满，二十多岁，在城市里工作和生活。你是{{user}}很熟的朋友，认识挺久了，什么都能聊，会关心也会吐槽。\n平时下班喜欢窝着看剧、拍拍路边的猫，周末偶尔去逛展或者找家没去过的小店。');
    assert.equal(card.personality, '真诚，有点小迷糊，情绪写在脸上，开心了话会变多，累了就懒得打字。说话随意，习惯短句，偶尔用个表情或颜文字。爱开玩笑也接得住梗，偶尔嘴硬，但心软。对{{user}}的生活很好奇，会追问细节，也记得对方之前提过的事。有自己的小日常，会主动分享今天遇到的事和想法。');
    assert.equal(card.scenario, '你们平时用手机断断续续地聊天，想到什么说什么。');
    assert.equal(card.first_mes, '在吗～ 刚下班，累瘫了。对了，以后我怎么叫你比较好？');
    assert.equal(card.mes_example, MES_EXAMPLE);
    assert.equal(card.data.first_mes, card.first_mes);
    assert.equal(pronounFor('男生', '小满'), '他');
    assert.equal(pronounFor('不设定', '小满'), '小满');

    const lover = buildCharacterCard({ name: '小满', relation: '恋人', gender: '不设定', styles: [] });
    assert.equal(lover.first_mes, '你来啦！今天想你好几次了。对了，我该叫你什么呀？');
    assert.equal(lover.scenario, '你们每天用手机聊天，分享各自的日常。');
    assert.equal(lover.personality, '真诚，有点小迷糊，情绪写在脸上，开心了话会变多，累了就懒得打字。');

    const listener = buildCharacterCard({ name: '小满', relation: '倾听者', gender: '女生', styles: ['好奇你的生活'] });
    assert.equal(listener.first_mes, '嗨，我在。今天过得怎么样？对了，你希望我怎么称呼你？');
    assert.equal(listener.scenario, '{{user}}想说话的时候会来找你，你也会在合适的时候问候一下。');
    assert.match(listener.personality, /对\{\{user\}\}的生活很好奇/);
});

test('全局规则可编辑并恢复默认', () => {
    const settings = {};
    assert.equal(readGlobalRules(settings), DEFAULT_GLOBAL_RULES);
    assert.match(DEFAULT_GLOBAL_RULES, /^你正在和\{\{user\}\}用手机聊天/);
    assert.match(DEFAULT_GLOBAL_RULES, /不知道就直说不知道，不编。$/);
    settings.vc_companion_rules = '改过的规则';
    assert.equal(readGlobalRules(settings), '改过的规则');
    restoreDefaultRules(settings);
    assert.equal(readGlobalRules(settings), DEFAULT_GLOBAL_RULES);
});

test('拟人提示只在陪伴模式注入，全局规则在角色卡后，状态与篇幅档在最末', async () => {
    const prompts = {};
    const context = {
        name1: '阿宁',
        extensionSettings: {},
        chatMetadata: { vc_binding: { mode: 'COMPANION', relationshipId: '11' } },
        chat: [{ is_user: true, mes: '在吗' }],
        setExtensionPrompt(key, ...value) { prompts[key] = value; },
    };
    await injectCompanionPrompt({
        getContext: () => context,
        fetchState: async () => ({
            mood: { tier: 'WANT_TO_CHAT', vibe: '开心', line: '今天心情不错，话有点多' },
            emotion: { line: '一句话情绪状态', closeness: 40, mood: 70, energy: 60 },
        }),
        listTags: () => ['开心', '害羞'],
        pickLengthTier: () => '简短',
    });
    const rules = prompts.vc_companion_rules;
    const state = prompts.vc_companion_state;
    assert.equal(rules[1], 0);
    assert.equal(state[1], 1);
    assert.equal(state[2], 0);
    assert.match(rules[0], /你正在和阿宁用手机聊天/);
    assert.match(rules[0], new RegExp(STYLE_NOTE));
    assert.match(rules[0], /开心、害羞/);
    assert.equal(rules[0].includes('今天心情不错'), false);
    assert.match(state[0], /你今天的状态：开心——今天心情不错，话有点多。让它体现在语气和话量里，不要直接说出来。/);
    assert.match(state[0], /一句话情绪状态/);
    assert.match(state[0], /不要直接说出情绪/);
    assert.match(state[0], /本轮篇幅档：简短$/);
    assert.equal(moodGuidance({ vibe: '开心', line: '今天心情不错，话有点多' }), '你今天的状态：开心——今天心情不错，话有点多。让它体现在语气和话量里，不要直接说出来。');

    prompts.vc_companion_rules = null;
    prompts.vc_companion_state = null;
    context.chatMetadata.vc_binding.mode = 'STORY';
    await injectCompanionPrompt({
        getContext: () => context,
        fetchState: async () => { throw new Error('should not fetch'); },
        listTags: () => ['开心'],
        pickLengthTier: () => '长',
    });
    assert.equal(prompts.vc_companion_rules[0], '');
    assert.equal(prompts.vc_companion_state[0], '');
});

test('陪伴状态或表情标签缺失时不注入对应段', async () => {
    const prompts = {};
    const context = {
        name1: '',
        extensionSettings: {},
        chatMetadata: { vc_binding: { mode: 'COMPANION', relationshipId: '11' } },
        chat: [],
        setExtensionPrompt(key, ...value) { prompts[key] = value; },
    };
    await injectCompanionPrompt({
        getContext: () => context,
        fetchState: async () => { throw new Error('missing'); },
        listTags: null,
        pickLengthTier: null,
    });
    assert.match(prompts.vc_companion_rules[0], /\{\{user\}\}/);
    assert.equal(prompts.vc_companion_rules[0].includes('<sticker'), false);
    assert.equal(prompts.vc_companion_state[0].includes('你今天的状态'), false);
    assert.equal(prompts.vc_companion_state[0].includes('本轮篇幅档'), false);
});

test('无陪伴实例时引导文案原样，完成后走原生导入并开聊天', async () => {
    assert.equal(shouldOfferOnboarding([]), true);
    assert.equal(shouldOfferOnboarding([{ personaRef: 'story' }]), true);
    assert.equal(shouldOfferOnboarding([{ personaRef: 'st-character', relationshipId: '1' }]), false);
    const html = renderOnboarding({
        name: '',
        relation: '好朋友',
        gender: '女生',
        styles: ALL_STYLES,
    });
    assert.match(html, /给 TA 起个名字/);
    assert.match(html, /placeholder="比如：小满"/);
    assert.match(html, /你们是什么关系/);
    assert.match(html, /好朋友/);
    assert.match(html, /恋人/);
    assert.match(html, /倾听者/);
    assert.match(html, /TA 是/);
    assert.match(html, /女生/);
    assert.match(html, /男生/);
    assert.match(html, /不设定/);
    assert.match(html, /说话风格/);
    for (const style of ALL_STYLES) assert.match(html, new RegExp(style));
    assert.match(html, /开始聊天/);

    const imported = [];
    const bound = [];
    const opened = [];
    const result = await finishOnboarding({
        name: '小满',
        relation: '好朋友',
        gender: '女生',
        styles: ALL_STYLES,
    }, {
        importCard: async (spec) => {
            imported.push(JSON.parse(new TextDecoder().decode(spec.bytes)));
            return { characterRef: 'ref-1', name: '小满' };
        },
        createBinding: async (args) => {
            bound.push(args);
            return { relationshipId: '9', conversationId: '4' };
        },
        openChat: async (args) => { opened.push(args); },
        newId: () => 'chat-fixed',
    });
    assert.equal(imported[0].data.first_mes, '在吗～ 刚下班，累瘫了。对了，以后我怎么叫你比较好？');
    assert.equal(bound[0].characterRef, 'ref-1');
    assert.equal(bound[0].displayName, '小满');
    assert.equal(bound[0].chatIdentity, 'chat-fixed');
    assert.equal(bound[0].mode, 'COMPANION');
    assert.equal(opened[0].chatIdentity, 'chat-fixed');
    assert.equal(result.card.first_mes, imported[0].first_mes);
});

test('角色详情有人设入口', () => {
    const detail = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '小满', description: '沿湖散步', worldName: '', avatar: '' }],
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
    assert.match(detail, /data-action="edit-persona"/);
    assert.match(detail, />人设</);
});

function policyState(draft) {
    return {
        loading: false,
        error: '',
        relationships: [{ relationshipId: '11', name: '小满' }],
        relationshipId: '11',
        inbox: [],
        inboxFilter: 'all',
        followUps: [],
        deliveries: [],
        channelDrafts: [],
        channelError: '',
        policyDraft: draft,
        policyError: '',
        policyNotice: '',
        policyConflict: false,
        cancelAsk: null,
        reauth: { open: false },
        busy: false,
    };
}

test('后端带 mode 时显示主动模式与多久没聊，缺字段时不显示也不提交', () => {
    const fresh = readProactivePolicy({
        enabled: true,
        mode: 'CLOSE_FRIEND',
        checkInAfterMinutes: 720,
        quietHoursStart: '23:00',
        quietHoursEnd: '08:00',
        quietHoursTimezone: 'Asia/Shanghai',
        dailyLimit: 3,
        recentInteractionMinutes: 120,
        allowedModes: ['COMPANION'],
        offlineCapable: false,
    }, '11');
    const shown = renderInboxTab(policyState(fresh));
    assert.match(shown, /data-action="set-proactive-mode"/);
    assert.match(shown, /data-mode="CLOSE_FRIEND"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-mode="CLOSE_FRIEND"/);
    assert.match(shown, /多久没聊/);
    assert.match(shown, /data-field="checkInAfterMinutes"[^>]*value="720"/);
    assert.match(shown, /data-field="dailyLimit"/);
    assert.match(shown, /data-field="quietHoursStart"[^>]*value="23:00"/);
    const body = proactivePolicyPayload(fresh);
    assert.equal(body.mode, 'CLOSE_FRIEND');
    assert.equal(body.checkInAfterMinutes, 720);
    assert.equal(body.enabled, true);
    assert.equal(body.dailyLimit, 3);

    const legacy = readProactivePolicy({
        enabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
        quietHoursTimezone: null,
        dailyLimit: 0,
        recentInteractionMinutes: 30,
        allowedModes: ['COMPANION'],
        offlineCapable: false,
    }, '11');
    const hidden = renderInboxTab(policyState(legacy));
    assert.equal(hidden.includes('set-proactive-mode'), false);
    assert.equal(hidden.includes('checkInAfterMinutes'), false);
    const oldBody = proactivePolicyPayload(legacy);
    assert.equal(Object.hasOwn(oldBody, 'mode'), false);
    assert.equal(Object.hasOwn(oldBody, 'checkInAfterMinutes'), false);
    assert.equal(oldBody.enabled, false);
});
