// 人设与全局拟人规则。文案来自 docs/planning/2026-10-30-companion-copy.md，原样使用。
import { icon } from './ui/icons.js';
import { openSheet } from './ui/sheet.js';
import { PLANNER_KEY } from './reply-planner.js';

export const STYLE_NOTE = '只作语气参考，不要照搬或重复';

export const DEFAULT_GLOBAL_RULES = `你正在和{{user}}用手机聊天，像朋友之间发微信，不是在写文章或回答问题。
- 多数时候只回一两句，口语、随意，可以省略主语、用语气词；偶尔才说长一点。
- 一次最多问一个问题。不用列表、标题、加粗，也不写括号或星号里的动作描写。
- 先接住对方的情绪，再说别的；不急着给建议，更不说教。
- 你有自己的生活、喜好和小情绪，可以聊自己的事，不必总围着对方转。
- 记得的事自然地带出来，像本来就知道一样；别说「我记得你说过」「根据记录」。
- 不说「有什么可以帮你」「希望对你有帮助」「总的来说」这类客套话和总结。
- 被问是不是 AI，别否认也别装成人类，用一句轻松的话带过，然后接着聊。
- 不知道就直说不知道，不编。`;

export const MES_EXAMPLE = `<START>
{{user}}: 今天好累
{{char}}: 抱抱
{{char}}: 是加班了还是被谁烦到了
<START>
{{user}}: 我升职了！
{{char}}: 真的假的！！
{{char}}: 今晚必须吃顿好的，你请客`;

export const RELATIONS = ['好朋友', '恋人', '倾听者'];
export const GENDERS = ['女生', '男生', '不设定'];
export const STYLE_OPTIONS = ['口语短句，偶尔表情', '幽默会接梗', '好奇你的生活', '分享自己的日常'];

const RELATION_COPY = {
    好朋友: {
        relationLine: '你是{{user}}很熟的朋友，认识挺久了，什么都能聊，会关心也会吐槽。',
        scenarioLine: '你们平时用手机断断续续地聊天，想到什么说什么。',
        first: '在吗～ 刚下班，累瘫了。对了，以后我怎么叫你比较好？',
    },
    恋人: {
        relationLine: '你和{{user}}在谈恋爱，喜欢黏着对方，会想念、会撒娇，也会关心对方有没有好好吃饭睡觉。',
        scenarioLine: '你们每天用手机聊天，分享各自的日常。',
        first: '你来啦！今天想你好几次了。对了，我该叫你什么呀？',
    },
    倾听者: {
        relationLine: '你是{{user}}信任的人，性子温和，善于倾听，不急着给建议，让对方愿意把心里话说出来。',
        scenarioLine: '{{user}}想说话的时候会来找你，你也会在合适的时候问候一下。',
        first: '嗨，我在。今天过得怎么样？对了，你希望我怎么称呼你？',
    },
};

const PERSONALITY_BASE = '真诚，有点小迷糊，情绪写在脸上，开心了话会变多，累了就懒得打字。';
const STYLE_LINES = {
    '口语短句，偶尔表情': '说话随意，习惯短句，偶尔用个表情或颜文字。',
    '幽默会接梗': '爱开玩笑也接得住梗，偶尔嘴硬，但心软。',
    '好奇你的生活': '对{{user}}的生活很好奇，会追问细节，也记得对方之前提过的事。',
    '分享自己的日常': '有自己的小日常，会主动分享今天遇到的事和想法。',
};

const RULES_KEY = 'vc_companion_rules';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function pronounFor(gender, name) {
    if (gender === '男生') return '他';
    if (gender === '女生') return '她';
    return String(name || '');
}

export function readGlobalRules(settings) {
    const saved = settings?.[RULES_KEY];
    return typeof saved === 'string' ? saved : DEFAULT_GLOBAL_RULES;
}

export function restoreDefaultRules(settings) {
    if (settings && typeof settings === 'object') settings[RULES_KEY] = DEFAULT_GLOBAL_RULES;
    return DEFAULT_GLOBAL_RULES;
}

export function moodGuidance(mood) {
    const vibe = String(mood?.vibe || '').trim();
    const line = String(mood?.line || '').trim();
    if (!vibe || !line) return '';
    return `你今天的状态：${vibe}——${line}。让它体现在语气和话量里，不要直接说出来。`;
}

export function buildCharacterCard({ name, relation = '好朋友', gender = '女生', styles = [] } = {}) {
    const cleanName = String(name || '').trim();
    const copy = RELATION_COPY[relation] || RELATION_COPY['好朋友'];
    const pronoun = pronounFor(gender, cleanName);
    const apply = (text) => String(text).replaceAll('{{name}}', cleanName).replaceAll('{{代词}}', pronoun);
    const chosen = (Array.isArray(styles) ? styles : []).filter((item) => STYLE_LINES[item]);
    const description = apply(`${cleanName}，二十多岁，在城市里工作和生活。${copy.relationLine}\n平时下班喜欢窝着看剧、拍拍路边的猫，周末偶尔去逛展或者找家没去过的小店。`);
    const personality = apply([PERSONALITY_BASE, ...chosen.map((item) => STYLE_LINES[item])].join(''));
    const scenario = apply(copy.scenarioLine);
    const first = copy.first;
    const data = {
        name: cleanName,
        description,
        personality,
        scenario,
        first_mes: first,
        mes_example: MES_EXAMPLE,
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: [],
        creator: '',
        character_version: '1.0',
        extensions: {
            vc_persona: { relation, gender, styles: chosen },
        },
    };
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        name: cleanName,
        description,
        personality,
        scenario,
        first_mes: first,
        mes_example: MES_EXAMPLE,
        data,
    };
}

export function renderCompanionStyle(text, { plannerEnabled = false } = {}) {
    return `<div data-planner-row><div class="vc-group"><div class="vc-cell"><span class="vc-grow">先想再说</span><button type="button" class="vc-switch" role="switch" aria-label="先想再说" aria-describedby="vc-planner-cost" aria-checked="${plannerEnabled?'true':'false'}" data-action="toggle-planner"><span></span></button></div></div><p class="vc-footnote" id="vc-planner-cost">可能增加一次模型用量。</p></div><label class="vc-style-rule"><textarea data-field="rules" aria-label="陪伴风格">${esc(text)}</textarea></label><button type="button" class="vc-btn vc-btn-text" data-action="restore-rules">恢复默认</button>`;
}

export function fitStyleField(area) {
    if (!area?.style) return;
    area.style.height = 'auto';
    area.style.maxHeight = 'none';
    area.style.overflow = 'hidden';
    const content = Number(area.scrollHeight) || 0;
    const page = typeof area.closest === 'function' ? area.closest('.vc-style-page') : null;
    const scroller = page?.parentElement;
    const button = page?.querySelector?.('[data-action="restore-rules"]');
    const buttonHeight = Number(button?.offsetHeight) || 0;
    const plannerHeight = Number(page?.querySelector?.('[data-planner-row]')?.offsetHeight) || 0;
    const scrollerHeight = Number(scroller?.clientHeight) || 0;
    const room = scrollerHeight > 0 ? Math.max(0, scrollerHeight - buttonHeight - plannerHeight) : Number(area.parentElement?.clientHeight) || 0;
    const next = Math.max(content, room);
    if (next > 0) area.style.height = `${next}px`;
}

export function renderPersonaEditor(fields = {}) {
    const row = (key, label) => `<label class="vc-cell vc-persona-field"><span class="vc-grow">${label}</span><textarea data-persona="${key}" aria-label="${label}">${esc(fields[key] || '')}</textarea></label>`;
    return `<header class="vc-navbar" style="--vc-nav-p:1"><button type="button" class="vc-circle vc-glass" data-action="close-persona" aria-label="返回">${icon('chevron-left')}</button><h1 class="vc-nav-title" tabindex="-1">人设</h1><div class="vc-nav-spacer"></div></header><div class="vc-scroll"><div class="vc-column"><div class="vc-group">${row('description', '介绍')}${row('personality', '性格')}${row('scenario', '情景')}${row('first_mes', '开场')}${row('mes_example', '例句')}</div><p data-persona-error role="alert"></p><button type="button" class="vc-btn vc-btn-fill" data-action="save-persona">保存</button></div></div>`;
}

export function ensureCompanionStyles(doc = globalThis.document) {
    if (!doc?.getElementById || doc.getElementById('vc-companion-persona-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-companion-persona-css';
    link.rel = 'stylesheet';
    link.href = new URL('./companion-persona.css', import.meta.url).href;
    (doc.head || doc.documentElement).append(link);
}

export function openCompanionStyle({ getContext, opener, document: doc = globalThis.document } = {}) {
    ensureCompanionStyles(doc);
    const context = typeof getContext === 'function' ? getContext() : { extensionSettings: {} };
    if (!context.extensionSettings || typeof context.extensionSettings !== 'object') context.extensionSettings = {};
    const box = doc.createElement('div');
    box.className = 'vc-column vc-style-page';
    box.innerHTML = renderCompanionStyle(readGlobalRules(context.extensionSettings), { plannerEnabled: context.extensionSettings[PLANNER_KEY] === true });
    const view = doc.defaultView || globalThis;
    let fit = () => {};
    const sheet = openSheet({
        title: '陪伴风格',
        large: true,
        body: box,
        opener,
        root: doc.body,
        onDone: () => view.removeEventListener?.('resize', fit),
    });
    const area = box.querySelector('[data-field="rules"]');
    fit = () => fitStyleField(area);
    view.addEventListener?.('resize', fit);
    const planner = box.querySelector('[data-action="toggle-planner"]');
    planner?.addEventListener('click', () => {
        context.extensionSettings[PLANNER_KEY] = planner.getAttribute('aria-checked') !== 'true';
        planner.setAttribute('aria-checked', String(context.extensionSettings[PLANNER_KEY]));
        context.saveSettingsDebounced?.();
    });
    area?.addEventListener('input', () => {
        context.extensionSettings[RULES_KEY] = area.value;
        context.saveSettingsDebounced?.();
        fit();
    });
    box.querySelector('[data-action="restore-rules"]')?.addEventListener('click', () => {
        restoreDefaultRules(context.extensionSettings);
        context.extensionSettings[PLANNER_KEY] = false;
        planner?.setAttribute('aria-checked', 'false');
        context.saveSettingsDebounced?.();
        if (area) area.value = DEFAULT_GLOBAL_RULES;
        fit();
    });
    if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(() => view.requestAnimationFrame(fit));
    else fit();
    return sheet;
}

export async function saveNativePersona({ getContext, characterRef, fields, fetchImpl = globalThis.fetch, headers = {} } = {}) {
    const ctx = typeof getContext === 'function' ? getContext() : {};
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const card = characters.find((item) => item?.data?.extensions?.vc_character_ref === characterRef);
    if (!card) throw new Error('missing card');
    const data = { ...(card.data || {}) };
    for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example']) {
        const value = String(fields?.[key] ?? '');
        data[key] = value;
        card[key] = value;
    }
    card.data = data;
    const body = new FormData();
    body.set('avatar_url', String(card.avatar || ''));
    body.set('ch_name', String(card.name || data.name || ''));
    for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example']) body.set(key, data[key]);
    body.set('json_data', JSON.stringify(data));
    const response = await fetchImpl('/api/characters/edit', { method: 'POST', headers, body });
    if (!response?.ok) throw new Error('save failed');
    return data;
}
