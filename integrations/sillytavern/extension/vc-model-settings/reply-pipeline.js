// 每轮回复流水线。格式由程序保证：防抖、篇幅档位置、后处理、分段、打字节奏。
// 表情包通过 registerBubbleTransformer 把 <sticker> 段换成自己的气泡，不改本文件的显示节点。

export const FIRST_DELAY_MS = 350;
export const ROUND_CAP_MS = 8000;
export const DEBOUNCE_SHORT_MS = 2000;
export const DEBOUNCE_LONG_MS = 5000;
export const DEBOUNCE_CAP_MS = 8000;
export const SHORT_SEND_CHARS = 40;
export const TYPING_COPY = '正在输入';
export const REPLY_STATE_KEY = 'vc_reply_state';
export const REPLY_TAIL_KEY = 'vc_reply_tail';
export const TAIL_MARK = '<vc-reply-tail>';

export const LENGTH_TIER_LINES = {
    简短: '本轮篇幅：简短。只回一两句，十到三十个字就够。',
    正常: '本轮篇幅：正常。可以说两三句，仍然像发微信。',
    长: '本轮篇幅：长一点。把事情说清楚，但不要写成文章或列表。',
    极短: '本轮篇幅：只回一两个字。',
};

const STICKER_RE = /<sticker\s+tag="[^"]*"\s*\/>/g;
const EMOTION_RE = /难过|伤心|生气|崩溃|焦虑|害怕|委屈|开心|高兴|兴奋|好累|烦死|想哭/;
const COURTESY = [
    '希望对你有帮助', '希望能帮到你', '希望我能帮到你', '有什么可以帮你', '有什么可以帮助你',
    '还有什么我可以帮', '如果还有其他问题', '如果还有什么问题', '很高兴为你服务', '祝你生活愉快',
];
const AS_AI = ['作为AI', '作为一个AI', '作为人工智能', '作为一个人工智能', '我是一个AI', '我是AI', '作为语言模型', '我是语言模型'];
const STOCK = ['总的来说', '总而言之', '综上所述', '简而言之', '总的来讲', '不难看出', '值得一提的是'];
const APHORISM = [/生活就像/, /人生就像/, /时间就像/, /不是[^。！？\n]{1,16}，而是/];
const SELF_RE = /我|咱|本人/;
const TURN_RE = /但是|然而|不过|可是/;

const bubbleTransformers = [];
let turnType = 'normal';
let rewriteHintText = '';

export function registerBubbleTransformer(fn) {
    if (typeof fn !== 'function') return () => {};
    bubbleTransformers.push(fn);
    return () => {
        const index = bubbleTransformers.indexOf(fn);
        if (index >= 0) bubbleTransformers.splice(index, 1);
    };
}

export function clearBubbleTransformers() {
    bubbleTransformers.length = 0;
}

export function applyBubbleTransformers(segments, ctx = {}) {
    let next = Array.isArray(segments) ? segments.slice() : [];
    for (const fn of [...bubbleTransformers]) {
        try {
            const out = fn(next, ctx);
            if (Array.isArray(out)) {
                next = out.map((item) => (typeof item === 'string' || (item && typeof item === 'object' && item.type === 'sticker') ? item : String(item ?? '')));
            }
        } catch { /* 单个变换失败时保留上一步。 */ }
    }
    return next;
}

function trimEdge(segment) {
    if (segment.startsWith('<sticker')) return segment;
    return segment.replace(/[。，,]+$/u, '').trim();
}

function splitCommas(part) {
    const bits = part.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
    const merged = [];
    let buf = '';
    for (const bit of bits) {
        buf = buf ? `${buf}${bit}` : bit;
        const count = [...buf.replace(/\s/g, '')].length;
        if (count >= 12) {
            merged.push(buf);
            buf = '';
        }
    }
    if (buf) {
        if (merged.length) merged[merged.length - 1] += buf;
        else merged.push(buf);
    }
    return merged.length ? merged : [part];
}

function splitProse(text) {
    const source = String(text || '').replace(/[ \t]+\n/g, '\n').trim();
    if (!source) return [];
    const compact = [...source.replace(/\s/g, '')].length;
    if (compact < 12 && !/[。！？~…\n]/.test(source)) return [source];
    const parts = source.split(/\n+|(?<=[。！？~…])/).map((item) => item.trim()).filter(Boolean);
    const out = [];
    for (const part of parts) {
        const count = [...part.replace(/\s/g, '')].length;
        if (count >= 24 && /[，,]/.test(part)) out.push(...splitCommas(part));
        else out.push(part);
    }
    return out;
}

function capSegments(segments) {
    if (segments.length <= 3) return segments;
    const sticker = segments.find((item) => item.startsWith('<sticker')) || '';
    const texts = segments.filter((item) => !item.startsWith('<sticker'));
    const room = sticker ? 2 : 3;
    let merged = texts;
    if (texts.length > room) {
        const keep = Math.max(room - 1, 0);
        const head = texts.slice(0, keep);
        const tail = texts.slice(keep).map(trimEdge).join('');
        merged = [...head, tail].filter(Boolean);
    }
    return (sticker ? [...merged, sticker] : merged).slice(0, 3);
}

export function splitReply(text, ctx = {}) {
    const raw = String(text ?? '').replace(/<voice\s*\/>/gi, '').replace(/\r\n/g, '\n').trim();
    if (!raw) return applyBubbleTransformers([], ctx);
    const pieces = [];
    let last = 0;
    for (const match of raw.matchAll(STICKER_RE)) {
        if (match.index > last) pieces.push(...splitProse(raw.slice(last, match.index)));
        pieces.push(match[0]);
        last = match.index + match[0].length;
    }
    if (last < raw.length) pieces.push(...splitProse(raw.slice(last)));
    const cleaned = pieces.map(trimEdge).filter(Boolean);
    return applyBubbleTransformers(capSegments(cleaned), ctx);
}

export function typingDelay(segment, index, { random = Math.random, reducedMotion = false, spentMs = 0 } = {}) {
    if (reducedMotion) return 0;
    const remain = ROUND_CAP_MS - (Number(spentMs) || 0);
    if (remain <= 0) return 0;
    let ms;
    if ((Number(index) || 0) <= 0) {
        ms = FIRST_DELAY_MS;
    } else {
        const chars = [...String(segment ?? '')].length;
        const base = Math.min(4, Math.max(0.8, 0.4 + 0.12 * chars));
        const roll = typeof random === 'function' ? Number(random()) : 0.5;
        const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0.5;
        const factor = 0.8 + unit * 0.4;
        ms = Math.round(base * factor * 1000);
    }
    return Math.min(ms, remain);
}

function stripThink(text) {
    const marks = ['</think>', '</think>'];
    let cut = -1;
    let size = 0;
    for (const mark of marks) {
        const index = text.lastIndexOf(mark);
        if (index >= 0 && index >= cut) {
            cut = index;
            size = mark.length;
        }
    }
    return cut >= 0 ? text.slice(cut + size) : text;
}

function protectStickers(text, transform) {
    const saved = [];
    const masked = text.replace(STICKER_RE, (match) => {
        const token = `\u0000S${saved.length}\u0000`;
        saved.push(match);
        return token;
    });
    return transform(masked).replace(/\u0000S(\d+)\u0000/g, (_, index) => saved[Number(index)] || '');
}

function stripLists(text) {
    return text.split('\n').map((line) => line
        .replace(/^\s*\d+[.)]\s+/, '')
        .replace(/^\s*[-+]\s+/, '')
        .replace(/^\s*\*\s+/, '')).join('\n');
}

function stripAsides(text) {
    let out = text.replace(/[*＊]([^*＊\n]{1,30})[*＊]/g, '');
    out = out.replace(/（[^（）\n]{1,20}）/g, (item) => (/[?？]/.test(item) ? item : ''));
    out = out.replace(/\([^()\n]{1,20}\)/g, (item) => (/[?？]/.test(item) ? item : ''));
    return out;
}

function maskQuotes(text) {
    return text
        .replace(/「[^」]*」/g, (item) => ' '.repeat(item.length))
        .replace(/『[^』]*』/g, (item) => ' '.repeat(item.length))
        .replace(/“[^”]*”/g, (item) => ' '.repeat(item.length))
        .replace(/"[^"\n]*"/g, (item) => ' '.repeat(item.length));
}

function collectViolations(text) {
    const masked = maskQuotes(text);
    const violations = [];
    const add = (code, label, hard) => violations.push({ code, label, hard });
    if (COURTESY.some((item) => masked.includes(item))) add('courtesy', '客套收尾', true);
    if (AS_AI.some((item) => masked.includes(item))) add('as-ai', '作为AI', true);
    if (STOCK.some((item) => masked.includes(item))) add('stock', '书面套话', true);
    let hardAphorism = false;
    let softAphorism = false;
    let turns = 0;
    let softTurns = false;
    for (const sentence of masked.split(/(?<=[。！？\n])/).map((item) => item.trim()).filter(Boolean)) {
        const self = SELF_RE.test(sentence);
        if (APHORISM.some((pattern) => pattern.test(sentence))) {
            if (self) softAphorism = true;
            else hardAphorism = true;
        }
        const found = sentence.match(new RegExp(TURN_RE.source, 'g'));
        if (found) {
            if (self) softTurns = true;
            else turns += found.length;
        }
    }
    if (hardAphorism) add('aphorism', '格言句式', true);
    else if (softAphorism) add('aphorism', '格言句式', false);
    if (turns >= 3) add('turns', '转折过多', true);
    else if (softTurns) add('turns', '转折过多', false);
    const questions = masked.match(/[?？]/g);
    if (questions && questions.length >= 2) add('questions', '多个问题', true);
    return violations;
}

export function postProcess(text) {
    const cleaned = protectStickers(stripThink(String(text ?? '')), (body) => stripAsides(stripLists(body)))
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { text: cleaned, violations: collectViolations(cleaned) };
}

export function rewriteHint(violations) {
    const labels = [...new Set((Array.isArray(violations) ? violations : []).filter((item) => item?.hard).map((item) => item.label).filter(Boolean))];
    return `上一句没有发出。原因：${labels.join('、')}。请换一种说法重写，不要解释原因。`;
}

export function planReplyAction({ text, rewritten = false } = {}) {
    const processed = postProcess(text);
    const hard = processed.violations.some((item) => item.hard);
    if (!rewritten && hard) return { action: 'rewrite', processed, hint: rewriteHint(processed.violations) };
    return { action: 'keep', processed, hint: '' };
}

export function pickLengthTier(userText, { random = Math.random } = {}) {
    const roll = typeof random === 'function' ? Number(random()) : 1;
    if (Number.isFinite(roll) && roll < 0.05) return '极短';
    const text = String(userText ?? '').trim();
    const count = [...text].length;
    const question = /[?？]/.test(text);
    if (count >= 40) return '长';
    if (question && count >= 18) return '长';
    if (count <= 8 && !question && !EMOTION_RE.test(text)) return '简短';
    return '正常';
}

export function guidanceTail({ stateText = '', userText = '', hint = '', random } = {}) {
    const tier = pickLengthTier(userText, { random });
    const lines = [];
    const state = String(stateText || '').trim();
    if (state) lines.push(state);
    lines.push(LENGTH_TIER_LINES[tier] || LENGTH_TIER_LINES['正常']);
    const extra = String(hint || '').trim();
    if (extra) lines.push(extra);
    return lines.join('\n');
}

export function formatTail(body) {
    return `${TAIL_MARK}\n${body}`;
}

function stripTail(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const content = messages[index]?.content;
        if (typeof content === 'string' && content.includes(TAIL_MARK)) messages.splice(index, 1);
    }
}

function lastUserText(context) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.is_user && typeof message.mes === 'string') return message.mes;
    }
    return '';
}

export function noteTurn(type) {
    turnType = type || 'normal';
}

export function armRewrite(text) {
    rewriteHintText = String(text || '');
}

export function consumeRewriteHint() {
    const value = rewriteHintText;
    rewriteHintText = '';
    return value;
}

export function placeGuidance(generateData, context, options = {}) {
    if (!generateData || !Array.isArray(generateData.messages)) return false;
    stripTail(generateData.messages);
    const type = options.type || turnType;
    if (type === 'quiet' || type === 'impersonate') return false;
    if (context?.chatMetadata?.vc_binding?.mode !== 'COMPANION') return false;
    const hint = options.hint !== undefined ? options.hint : consumeRewriteHint();
    const stateRaw = String(context?.extensionPrompts?.[REPLY_STATE_KEY]?.value || '').trim();
    const blob = generateData.messages.map((message) => (typeof message?.content === 'string' ? message.content : '')).join('\n');
    const stateText = stateRaw && !blob.includes(stateRaw) ? stateRaw : '';
    const body = guidanceTail({
        stateText, userText: lastUserText(context), hint, random: options.random,
    });
    generateData.messages.push({ role: 'system', content: formatTail(body) });
    return true;
}

export function installReplyTail(getContext) {
    const read = typeof getContext === 'function' ? getContext : () => null;
    let ctx;
    try { ctx = read(); } catch { return; }
    const source = ctx?.eventSource;
    const types = ctx?.eventTypes;
    if (!source?.on || !types?.CHAT_COMPLETION_SETTINGS_READY || source.vcReplyTail) return;
    source.vcReplyTail = true;
    source.on(types.CHAT_COMPLETION_SETTINGS_READY, (data) => {
        try { placeGuidance(data, read()); } catch { /* 提示词位置失败时不阻断发送。 */ }
    });
}

export function quietWaitMs(text) {
    return /[。！？~…!?]$/.test(String(text || '').trim()) ? DEBOUNCE_SHORT_MS : DEBOUNCE_LONG_MS;
}

export function shouldQueueSend(text, pendingCount = 0) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (pendingCount > 0) return true;
    return [...value].length <= SHORT_SEND_CHARS;
}

export function createSendBurst({ now = Date.now, schedule = setTimeout, cancel = clearTimeout, onFlush } = {}) {
    let parts = [];
    let started = 0;
    let timer = null;
    const clearTimer = () => {
        if (timer) cancel(timer);
        timer = null;
    };
    const flush = () => {
        clearTimer();
        const text = parts.join('\n');
        parts = [];
        started = 0;
        if (text) onFlush(text);
    };
    return {
        push(text) {
            const piece = String(text || '').trim();
            if (!piece) return { waitMs: 0, flushed: false };
            const clock = now();
            if (!parts.length) started = clock;
            parts.push(piece);
            const capLeft = DEBOUNCE_CAP_MS - (clock - started);
            const waitMs = Math.max(0, Math.min(quietWaitMs(piece), capLeft));
            clearTimer();
            if (waitMs === 0) {
                flush();
                return { waitMs: 0, flushed: true };
            }
            timer = schedule(flush, waitMs);
            return { waitMs, flushed: false };
        },
        flush,
        pending: () => parts.length,
        reset() {
            clearTimer();
            parts = [];
            started = 0;
        },
    };
}
