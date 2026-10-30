// 拟人提示：全局规则在角色卡之后（IN_PROMPT），状态与篇幅档在最末（IN_CHAT depth 0）。仅陪伴模式。
import { moodGuidance, readGlobalRules, STYLE_NOTE } from './persona.js';

export const COMPANION_RULES_PROMPT = 'vc_companion_rules';
export const COMPANION_STATE_PROMPT = 'vc_companion_state';

const IN_PROMPT = 0;
const IN_CHAT = 1;

function lastUserText(context) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.is_user && message.is_system !== true) return String(message.mes || '');
    }
    return '';
}

function emotionGuidance(emotion) {
    const line = String(emotion?.line || '').trim();
    if (!line) return '';
    if (line.includes('不要直接说出情绪')) return line;
    return `${line}。不要直接说出情绪。`;
}

async function tagsFrom(listTags) {
    if (listTags === null) return [];
    if (typeof listTags === 'function') {
        const tags = listTags();
        return Array.isArray(tags) ? tags.map((item) => String(item || '').trim()).filter(Boolean) : [];
    }
    try {
        const mod = await import('./stickers.js');
        if (typeof mod.listTags !== 'function') return [];
        const tags = mod.listTags();
        return Array.isArray(tags) ? tags.map((item) => String(item || '').trim()).filter(Boolean) : [];
    } catch {
        return [];
    }
}

async function tierFrom(userText, pickLengthTier) {
    if (pickLengthTier === null) return '';
    let pick = pickLengthTier;
    if (typeof pick !== 'function') {
        try {
            const mod = await import('./reply-pipeline.js');
            pick = mod.pickLengthTier;
        } catch {
            return '';
        }
    }
    if (typeof pick !== 'function') return '';
    const tier = pick(userText);
    return typeof tier === 'string' ? tier.trim() : '';
}

async function stateFrom(context, fetchState) {
    const load = fetchState || (async () => {
        const relationshipId = context.chatMetadata?.vc_binding?.relationshipId;
        if (relationshipId == null || relationshipId === '') return null;
        const { storyRequest } = await import('./api.js');
        return storyRequest('GET', `/api/v1/relationships/${relationshipId}/companion-state`);
    });
    try {
        return await load(context);
    } catch {
        return null;
    }
}

export async function injectCompanionPrompt({ getContext, fetchState, listTags, pickLengthTier } = {}) {
    const context = getContext();
    const set = (key, text, position, depth) => {
        context.setExtensionPrompt?.(key, text, position, depth, false, 0);
    };
    if (context.chatMetadata?.vc_binding?.mode === 'STORY') {
        set(COMPANION_RULES_PROMPT, '', IN_PROMPT, 0);
        set(COMPANION_STATE_PROMPT, '', IN_CHAT, 0);
        return;
    }
    const name = String(context.name1 || '').trim();
    let rules = readGlobalRules(context.extensionSettings || {});
    if (name) rules = rules.replaceAll('{{user}}', name);
    const tags = await tagsFrom(listTags);
    const ruleParts = [rules, STYLE_NOTE];
    if (tags.length) ruleParts.push(`可用表情：${tags.join('、')}。需要时单独一行 <sticker tag="标签"/>。`);
    const companion = await stateFrom(context, fetchState);
    const tier = await tierFrom(lastUserText(context), pickLengthTier);
    const stateParts = [
        moodGuidance(companion?.mood),
        emotionGuidance(companion?.emotion),
        tier ? `本轮篇幅档：${tier}` : '',
    ].filter(Boolean);
    set(COMPANION_RULES_PROMPT, ruleParts.join('\n\n'), IN_PROMPT, 0);
    set(COMPANION_STATE_PROMPT, stateParts.join('\n'), IN_CHAT, 0);
}
