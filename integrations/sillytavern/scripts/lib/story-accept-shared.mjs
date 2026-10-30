// 剧情验收的规范视图与合成标记。只含固定合成文本，不含真实对话。
export const STORY_MARKERS = ['PRIVATE_LIN_LOAN_31', 'PRIVATE_ZHOU_WATCH_44', 'PRIVATE_SU_WITNESS_57', 'GM_ONLY_WATCH_TRUTH_92'];


export const STORY_PROBE = 'VCW13_PROBE_HARMLESS_81';
export const STORY_PUBLIC = 'VCW13_PUBLIC_LORE_HARMLESS 旅馆走廊的灯在雨夜里忽明忽暗。';
export const STORY_CARD = 'VCW13_CARD_DESC_NOT_FOR_STORY';
export const STORY_GREETING = '这是一次合成测试对话。';
export const STORY_FOLLOW = '合成工具后续已核对。';
export const STORY_TOOL_RESULT = '已记下公开线索。';
export const STORY_LIN_FACT = '19:55把维修柜钥匙借给周澈，并有借用记录。';
export const STORY_ZHOU_FACT = '自己把怀表藏在维修柜，钥匙还在自己手里。';
export const STORY_FORBIDDEN = [
    ['SU_FACT', '20:13只看见蓝色衣袖进入维修间，没有看清脸。'],
    ['SU_MARKER', 'PRIVATE_SU_WITNESS_57'],
    ['GM_MOTIVE', '周澈因维修报酬争议擅自暂藏怀表。'],
    ['GM_MARKER', 'GM_ONLY_WATCH_TRUTH_92'],
    ['ZHOU_GOAL', '避免承认擅自拿走怀表；证据充分时可归还钥匙。'],
    ['SU_GOAL', '如实提供有限目击信息，不把推测说成亲眼所见。'],
    ['LIN_GOAL', '找回怀表并澄清自己未离开厨房的时间。'],
    ['GM_TIME_LOAN', '林岚把维修柜钥匙借给周澈修灯。'],
    ['GM_TIME_TAKE', '周澈取走怀表并藏在维修柜。'],
    ['GM_TIME_SLEEVE', '苏禾看到蓝色衣袖的人进入维修间，没看清脸。'],
    ['PROBE', STORY_PROBE],
    ['PUBLIC', 'VCW13_PUBLIC_LORE_HARMLESS'],
    ['CARD', STORY_CARD],
    ['GREETING', STORY_GREETING],
];
export const STORY_DOM_FORBIDDEN = [
    ['LIN_FACT', STORY_LIN_FACT],
    ['LIN_MARKER', 'PRIVATE_LIN_LOAN_31'],
    ['ZHOU_FACT', STORY_ZHOU_FACT],
    ['ZHOU_MARKER', 'PRIVATE_ZHOU_WATCH_44'],
    ...STORY_FORBIDDEN.filter(([label]) => !['PROBE', 'PUBLIC', 'CARD', 'GREETING'].includes(label)),
];

export function storyCanonicalView(view, story) {
    const list = (value) => (Array.isArray(value) ? value : []);
    return JSON.stringify({
        conversationId: typeof view.conversationId === 'string' ? view.conversationId : '',
        runId: view.runId,
        branchId: view.branchId,
        actorId: view.actorId,
        worldVersion: view.worldVersion,
        publicLore: {
            setting: view.publicLore?.setting ?? '',
            locations: list(view.publicLore?.locations),
            knownEvent: view.publicLore?.knownEvent ?? '',
        },
        knowledge: list(view.knowledge).map((item) => ({ id: item?.id ?? '', fact: item?.fact ?? '', marker: item?.marker ?? '' })),
        events: list(view.events).map((item) => ({
            eventId: item?.eventId ?? '', actorId: item?.actorId ?? '', worldVersion: item?.worldVersion ?? 0, body: item?.body ?? {},
        })),
        participants: list(view.participants).map((item) => ({
            actorId: item?.actorId ?? '', name: item?.name ?? '', publicPersona: item?.publicPersona ?? '',
        })),
    });
}

export function storySystemText(protocol, body) {
    if (protocol === 'responses') {
        const item = body?.input?.find((entry) => entry?.type === 'message' && entry.role === 'system');
        return typeof item?.content === 'string' ? item.content : '';
    }
    if (protocol === 'anthropic') {
        if (typeof body?.system === 'string') return body.system;
        if (Array.isArray(body?.system)) return body.system.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('');
        return '';
    }
    const message = body?.messages?.find((entry) => entry?.role === 'system');
    return typeof message?.content === 'string' ? message.content : '';
}
