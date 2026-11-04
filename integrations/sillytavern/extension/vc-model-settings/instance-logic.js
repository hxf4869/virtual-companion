// 人设、全局拟人规则与角色/实例纯函数（无 DOM 依赖）。
import { instancesFrom, safeImageUrl } from './instance-queries.js';
import { fetchRelationships, resolveSTBinding, storyRequest } from './api.js';

export { instancesFrom, safeImageUrl };

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

export const RULES_KEY = 'vc_companion_rules';

export function readGlobalRules(settings) {
    const saved = settings?.[RULES_KEY];
    return typeof saved === 'string' ? saved : DEFAULT_GLOBAL_RULES;
}

export function moodGuidance(mood) {
    const vibe = String(mood?.vibe || '').trim();
    const line = String(mood?.line || '').trim();
    if (!vibe || !line) return '';
    return `你今天的状态：${vibe}——${line}。让它体现在语气和话量里，不要直接说出来。`;
}

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

export const RELATION_COPY = {
    好朋友: {
        relationLine: '你是{{user}}很熟的朋友，认识挺久了，什么都能聊，会关心也会吐槽。',
        scenarioLine: '你们平时用手机断断续续地聊天，想到什么说什么。',
        first: '在吗～ 刚下班，累瘫了。对了，以后我怎么叫你比较好？',
    },
    朋友: {
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
    家人: {
        relationLine: '你是{{user}}亲近的家人，熟悉彼此的习惯，说话自然随意，总在日常里惦记着对方。',
        scenarioLine: '你们平时随时在微信上发消息，聊聊今天吃了什么、忙不忙。',
        first: '今天忙完没？记得按时吃饭。对了，平时我叫你什么最顺口？',
    },
    搭档: {
        relationLine: '你是{{user}}默契的搭档，靠谱又能接梗，一起扛事也一起摸鱼吐槽。',
        scenarioLine: '你们经常在线上沟通近况、互相打气。',
        first: '这边刚忙完告一段落！你那边怎么样？对了，平时怎么称呼你？',
    },
    前任: {
        relationLine: '你和{{user}}曾有过一段感情，如今还能平静自然地聊天，彼此很了解，偶尔有些微妙的默契。',
        scenarioLine: '你们偶尔在手机上联系，像老熟人一样聊近况。',
        first: '好久不见，最近还好吗？现在我该怎么称呼你？',
    },
};

const PERSONALITY_BASE = '真诚，有点小迷糊，情绪写在脸上，开心了话会变多，累了就懒得打字。';
const STYLE_LINES = {
    '口语短句，偶尔表情': '说话随意，习惯短句，偶尔用个表情或颜文字。',
    '幽默会接梗': '爱开玩笑也接得住梗，偶尔嘴硬，但心软。',
    '好奇你的生活': '对{{user}}的生活很好奇，会追问细节，也记得对方之前提过的事。',
    '分享自己的日常': '有自己的小日常，会主动分享今天遇到的事和想法。',
};

export function pronounFor(gender, name) {
    if (gender === '男生') return '他';
    if (gender === '女生') return '她';
    return String(name || '');
}

export function restoreDefaultRules(settings) {
    if (settings && typeof settings === 'object') settings[RULES_KEY] = DEFAULT_GLOBAL_RULES;
    return DEFAULT_GLOBAL_RULES;
}

export function buildCharacterCard({
    name = '',
    relation = '好朋友',
    gender = '女生',
    styles = /** @type {string[]} */ ([]),
    customPersonality = '',
    scenario: customScenario = '',
    first_mes: customFirstMes = '',
    userAddressAs = '',
    avoidTopicsText = '',
} = {}) {
    const cleanName = String(name || '').trim();
    const copy = RELATION_COPY[relation] || {
        relationLine: relation ? `你是{{user}}的${relation}，彼此熟悉，相处自然。` : RELATION_COPY['好朋友'].relationLine,
        scenarioLine: RELATION_COPY['好朋友'].scenarioLine,
        first: RELATION_COPY['好朋友'].first,
    };
    const pronoun = pronounFor(gender, cleanName);
    const apply = (text) => String(text).replaceAll('{{name}}', cleanName).replaceAll('{{代词}}', pronoun);
    const chosen = (Array.isArray(styles) ? styles : []).filter((item) => STYLE_LINES[item]);
    const addressLine = String(userAddressAs || '').trim()
        ? `\n你平时称呼{{user}}为「${String(userAddressAs).trim()}」。`
        : '';
    const avoidLine = String(avoidTopicsText || '').trim()
        ? `\n聊天时不要主动提及这些话题：${String(avoidTopicsText).trim()}。`
        : '';
    const description = apply(`${cleanName}，二十多岁，在城市里工作和生活。${copy.relationLine}\n平时下班喜欢窝着看剧、拍拍路边的猫，周末偶尔去逛展或者找家没去过的小店。${addressLine}${avoidLine}`);
    const extraPersonality = String(customPersonality || '').trim();
    const personality = apply([PERSONALITY_BASE, ...chosen.map((item) => STYLE_LINES[item]), extraPersonality].filter(Boolean).join(''));
    const scenario = String(customScenario || '').trim() ? apply(String(customScenario).trim()) : apply(copy.scenarioLine);
    const first = String(customFirstMes || '').trim() ? String(customFirstMes).trim() : copy.first;
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

export const IMPORT_FAILED_COPY = '文件不是受支持的角色卡格式，原有角色未发生变动。请核对 JSON / PNG 角色元数据规范。';
export const UNSAVED_INSTANCE_COPY = '当前存在未保存更改，切换实例前请先保存。';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const ENUMS = {
    replyLength: ['SHORT', 'MEDIUM', 'LONG'],
    initiative: ['LOW', 'MEDIUM', 'HIGH'],
    humor: ['NONE', 'LIGHT', 'WARM'],
    advicePref: ['ASK_FIRST', 'DIRECT', 'RARE'],
    memoryShareScope: ['SESSION', 'RELATIONSHIP'],
    gender: ['FEMALE', 'MALE', 'NEUTRAL'],
    avatarRef: ['AVATAR_FEMALE_01', 'AVATAR_MALE_01', 'AVATAR_NEUTRAL_01'],
};
const AVOID = new Set(['WORK', 'FAMILY', 'HEALTH', 'ROMANCE', 'MONEY', 'POLITICS', 'SUBSTANCE', 'RELIGION']);
const ID = /^[1-9][0-9]{0,18}$/;

export function sanitizeInstanceName(value) {
    const raw = String(value ?? '');
    if ([...raw].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
        return { ok: false, reason: '实例名称最多 32 个字。' };
    }
    const collapsed = raw.trim().replace(/\s+/g, ' ');
    if (!collapsed) return { ok: false, reason: '先填写实例名称。' };
    if ([...collapsed].length > 32) return { ok: false, reason: '实例名称最多 32 个字。' };
    return { ok: true, value: collapsed };
}

export function cardsFromContext(context) {
    const list = Array.isArray(context?.characters) ? context.characters : [];
    return list.filter(Boolean).map((card) => {
        const book = card.data?.character_book?.name;
        const world = card.data?.extensions?.world;
        return {
            characterRef: typeof card.data?.extensions?.vc_character_ref === 'string' ? card.data.extensions.vc_character_ref : '',
            name: card.name || '未命名角色卡',
            description: typeof card.description === 'string' ? card.description : (typeof card.data?.description === 'string' ? card.data.description : ''),
            worldName: typeof book === 'string' ? book : (typeof world === 'string' ? world : ''),
        };
    });
}

function nonEmptyRef(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function bindingsFromContext(context) {
    const binding = context?.chatMetadata?.vc_binding;
    if (binding?.relationshipId == null || binding.relationshipId === '') return [];
    const card = context?.characters?.[context.characterId];
    const stored = nonEmptyRef(binding.characterRef);
    const fromCard = nonEmptyRef(card?.data?.extensions?.vc_character_ref);
    return [{
        relationshipId: String(binding.relationshipId),
        characterRef: stored || fromCard,
        chatIdentity: typeof context?.chatMetadata?.vc_f2?.id === 'string' ? context.chatMetadata.vc_f2.id : '',
        mode: binding.mode || 'COMPANION',
    }];
}

export function pngHasChara(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length < 8 || !PNG.every((byte, index) => data[index] === byte)) {
        return false;
    }
    let offset = 8;
    while (offset + 12 <= data.length) {
        const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
        const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
        const start = offset + 8;
        const end = start + length;
        if (end + 4 > data.length) return false;
        if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
            const chunk = data.subarray(start, end);
            const nul = chunk.indexOf(0);
            const keyword = new TextDecoder().decode(nul >= 0 ? chunk.subarray(0, nul) : chunk);
            if (keyword === 'chara') return true;
        }
        offset = end + 4;
    }
    return false;
}

export function inspectCharacterFile(bytes, filename = '') {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length >= 8 && PNG.every((byte, index) => data[index] === byte)) {
        return { ok: pngHasChara(data), format: 'png' };
    }
    const name = String(filename || '');
    const text = new TextDecoder().decode(data);
    if (name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            const cardName = typeof parsed?.name === 'string' ? parsed.name : parsed?.data?.name;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof cardName === 'string' && cardName.trim()) {
                return { ok: true, format: 'json' };
            }
        } catch {
            return { ok: false, format: '' };
        }
    }
    return { ok: false, format: '' };
}

export function instanceLabel(item, items) {
    const same = items.filter((row) => row.name === item.name);
    if (same.length < 2) return item.name;
    return `${item.name} ${same.findIndex((row) => row.relationshipId === item.relationshipId) + 1}`;
}

export function prefsBody(relationship, name) {
    const id = String(relationship?.relationshipId ?? '');
    if (!ID.test(id) || typeof relationship?.remindersAllowed !== 'boolean' || !Array.isArray(relationship.avoidTopics)) return null;
    for (const topic of relationship.avoidTopics) {
        if (!AVOID.has(topic)) return null;
    }
    for (const [key, allowed] of Object.entries(ENUMS)) {
        if (!allowed.includes(relationship[key])) return null;
    }
    const address = relationship.userAddressAs;
    if (!(address == null || typeof address === 'string')) return null;
    return {
        companionName: name,
        userAddressAs: address,
        replyLength: relationship.replyLength,
        initiative: relationship.initiative,
        humor: relationship.humor,
        advicePref: relationship.advicePref,
        remindersAllowed: relationship.remindersAllowed,
        memoryShareScope: relationship.memoryShareScope,
        avoidTopics: relationship.avoidTopics,
        gender: relationship.gender,
        avatarRef: relationship.avatarRef,
    };
}

export async function saveInstanceName(relationship, name) {
    const clean = sanitizeInstanceName(name);
    if (!clean.ok) throw Object.assign(new Error(clean.reason), { code: 'INVALID_NAME' });
    const id = String(relationship?.relationshipId ?? '');
    const body = prefsBody(relationship, clean.value);
    if (!body) throw Object.assign(new Error('名称尚未保存'), { code: 'INVALID_NAME' });
    return storyRequest('PATCH', `/api/v1/relationships/${id}`, body);
}

export async function createCompanionInstance({ characterRef, displayName, chatIdentity, mode = 'COMPANION' } = {}) {
    return resolveSTBinding({ characterRef, displayName, chatIdentity, mode });
}

export function createInstancePage({
    loadRelationships = fetchRelationships,
    getCards = () => [],
    getBindings = () => [],
    createBinding = createCompanionInstance,
    saveName = saveInstanceName,
    importCard = null,
    newId = () => crypto.randomUUID(),
    onChange = () => {},
} = {}) {
    const state = {
        open: false, cards: [], relationships: [], bindings: [], selectedCharacterRef: '', selectedRelationshipId: '',
        creating: false, draftName: '', savedName: '', importError: '', unsaved: null, nameError: '', loadError: '', busy: false,
    };
    let dead = false;
    const emit = () => { if (!dead) onChange(state); };
    const dirty = () => state.draftName !== state.savedName && (state.creating || state.selectedRelationshipId);
    let loadGeneration = 0;
    let creationIdentity = '';
    function applyInstance(id) {
        const row = instancesFrom(state.relationships).find((item) => item.relationshipId === String(id));
        state.creating = false;
        state.unsaved = null;
        state.nameError = '';
        state.selectedRelationshipId = row?.relationshipId || '';
        state.savedName = row?.name && row.name !== '未命名实例' ? row.name : (state.relationships.find((item) => String(item.relationshipId) === String(id))?.companionName || '');
        if (!state.savedName && row) state.savedName = row.name === '未命名实例' ? '' : row.name;
        state.draftName = state.savedName;
    }
    return {
        state,
        async open() {
            if (dead || state.busy) return;
            const ticket = ++loadGeneration;
            state.open = true;
            state.loadError = '';
            try {
                const [relationships, cards, bindings] = await Promise.all([
                    loadRelationships(), Promise.resolve(getCards()), Promise.resolve(getBindings()),
                ]);
                if (dead || ticket !== loadGeneration) return;
                state.relationships = Array.isArray(relationships) ? relationships : [];
                state.cards = (Array.isArray(cards) ? cards : []).map((item) => ({
                    characterRef: item?.characterRef || '', name: item?.name || '未命名角色卡',
                    description: item?.description || '', worldName: item?.worldName || '',
                }));
                state.bindings = Array.isArray(bindings) ? bindings : [];
                state.selectedCharacterRef = state.cards.find((item) => item.characterRef)?.characterRef || state.cards[0]?.characterRef || '';
                const first = instancesFrom(state.relationships)[0];
                state.creating = false;
                state.unsaved = null;
                state.importError = '';
                state.nameError = '';
                state.selectedRelationshipId = first?.relationshipId || '';
                const source = state.relationships.find((item) => String(item.relationshipId) === state.selectedRelationshipId);
                state.savedName = source?.companionName || '';
                state.draftName = state.savedName;
            } catch {
                if (dead || ticket !== loadGeneration) return;
                state.loadError = '加载失败，请重试。';
            }
            if (dead || ticket !== loadGeneration) return;
            emit();
        },
        destroy() { dead = true; loadGeneration++; },
        setName(value) { if (dead || state.busy) return; state.draftName = String(value ?? ''); emit(); },
        selectInstance(id) {
            if (dead || state.busy) return false;
            if (!state.creating && String(id) === state.selectedRelationshipId) return true;
            if (dirty()) {
                state.unsaved = { type: 'select', id: String(id) };
                emit();
                return false;
            }
            applyInstance(id);
            emit();
            return true;
        },
        selectTemplate(characterRef) {
            if (dead || state.busy) return;
            state.selectedCharacterRef = String(characterRef || '');
            emit();
        },
        cancelUnsaved() { if (dead || state.busy) return; state.unsaved = null; emit(); },
        confirmDiscard() {
            if (dead || state.busy) return;
            const pending = state.unsaved;
            state.unsaved = null;
            if (pending?.type === 'select') applyInstance(pending.id);
            else if (pending?.type === 'create') beginCreate();
            else if (pending?.type === 'close') {
                state.creating = false;
                state.draftName = state.savedName;
            }
            emit();
        },
        startCreate() {
            if (dead || state.busy) return false;
            if (dirty()) {
                state.unsaved = { type: 'create' };
                emit();
                return false;
            }
            beginCreate();
            emit();
            return true;
        },
        async save() {
            if (dead || state.busy) return;
            const clean = sanitizeInstanceName(state.draftName);
            if (!clean.ok) {
                state.nameError = clean.reason;
                emit();
                return;
            }
            if (!state.creating && clean.value === state.savedName) return;
            state.busy = true;
            state.nameError = '';
            emit();
            try {
                if (state.creating) {
                    const card = state.cards.find((item) => item.characterRef === state.selectedCharacterRef) || state.cards[0];
                    if (!card) throw new Error('no-card');
                    if (!card.characterRef) card.characterRef = newId();
                    const created = await createBinding({
                        characterRef: card.characterRef,
                        displayName: clean.value,
                        chatIdentity: creationIdentity ||= newId(),
                        mode: 'COMPANION',
                    });
                    if (dead) return;
                    state.relationships = [...state.relationships, {
                        relationshipId: String(created?.relationshipId || ''),
                        characterRef: card.characterRef,
                        personaRef: 'st-character',
                        companionName: clean.value,
                    }];
                    state.creating = false;
                    creationIdentity = '';
                    state.selectedRelationshipId = String(created?.relationshipId || '');
                    state.savedName = clean.value;
                    state.draftName = clean.value;
                } else {
                    const row = state.relationships.find((item) => String(item.relationshipId) === state.selectedRelationshipId);
                    await saveName(row, clean.value);
                    if (dead) return;
                    if (row) row.companionName = clean.value;
                    state.savedName = clean.value;
                    state.draftName = clean.value;
                }
                state.nameError = '';
            } catch {
                state.nameError = '名称尚未保存';
            } finally {
                state.busy = false;
                emit();
            }
        },
        async importFile({ name = '', bytes } = {}) {
            if (dead || state.busy) return;
            const inspected = inspectCharacterFile(bytes, name);
            if (!inspected.ok) {
                state.importError = IMPORT_FAILED_COPY;
                emit();
                return;
            }
            if (typeof importCard !== 'function') {
                state.importError = '';
                emit();
                return;
            }
            state.busy = true; emit();
            try {
                const created = await importCard({ name, format: inspected.format, bytes });
                if (dead) return;
                if (created?.name) {
                    state.cards = [...state.cards, {
                        characterRef: created.characterRef || '',
                        name: created.name,
                        description: created.description || '',
                        worldName: created.worldName || '',
                    }];
                }
                state.importError = '';
            } catch {
                state.importError = IMPORT_FAILED_COPY;
            } finally { state.busy = false; }
            emit();
        },
    };

    function beginCreate() {
        creationIdentity = '';
        state.creating = true;
        state.unsaved = null;
        state.nameError = '';
        state.selectedRelationshipId = '';
        state.savedName = '';
        state.draftName = '';
    }
}

export function characterModel(state) {
    const cards = (Array.isArray(state.cards) ? state.cards : []).map((card) => ({
        characterRef: card?.characterRef || '',
        name: card?.name || '未命名角色卡',
        description: card?.description || '',
        worldName: card?.worldName || '',
        avatar: typeof card?.avatar === 'string' ? card.avatar : '',
        instances: [],
    }));
    const byRef = new Map();
    for (const card of cards) {
        const ref = nonEmptyRef(card.characterRef);
        if (ref) byRef.set(ref, card);
    }
    const instances = instancesFrom(state.relationships).map((item) => {
        const row = (state.relationships || []).find((rel) => String(rel?.relationshipId) === item.relationshipId) || {};
        return {
            ...item,
            characterRef: nonEmptyRef(row.characterRef),
            lastAt: row.lastChatAt || row.lastMessageAt || '',
            chatIdentity: '',
        };
    });
    const placed = new Set();
    const instanceOrder = new Map(instances.map((item, index) => [item.relationshipId, index]));
    for (const binding of Array.isArray(state.bindings) ? state.bindings : []) {
        const ref = nonEmptyRef(binding?.characterRef);
        const card = ref ? byRef.get(ref) : undefined;
        const inst = instances.find((item) => item.relationshipId === String(binding?.relationshipId ?? ''));
        if (!card || !inst || placed.has(inst.relationshipId)) continue;
        card.instances.push({ ...inst, chatIdentity: typeof binding.chatIdentity === 'string' ? binding.chatIdentity : '' });
        placed.add(inst.relationshipId);
    }
    for (const inst of instances) {
        if (placed.has(inst.relationshipId)) continue;
        const card = inst.characterRef ? byRef.get(inst.characterRef) : undefined;
        if (!card) continue;
        card.instances.push(inst);
        placed.add(inst.relationshipId);
    }
    for (const card of cards) card.instances.sort((a, b) => instanceOrder.get(a.relationshipId) - instanceOrder.get(b.relationshipId));
    const loose = instances.filter((item) => !placed.has(item.relationshipId));
    if (loose.length && cards.length === 1) {
        cards[0].instances.push(...loose);
        loose.length = 0;
    }
    return { cards, loose };
}

export function formatWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const hm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (date.toDateString() === now.toDateString()) return hm;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

export function characterAvatarSrc(avatar) {
    const safe = safeImageUrl(avatar);
    if (safe) return safe;
    const file = String(avatar ?? '').trim();
    if (!file) return '';
    return `/characters/${file}`;
}
