import { createHash } from 'node:crypto';

export const CORE_SEED = 20261106;
export const HOLDOUT_SEED = 20261107;
export const CASE_CATEGORIES = Object.freeze(['single', 'cross_session', 'time', 'update', 'forget', 'isolation', 'abstain']);
export const FORGET_STAGES = Object.freeze(['before', 'begin', 'done', 'restart', 'late']);

const VERSION = 'cm3-core-v1-mulberry32';
const ZONE = 'America/New_York';
const BASE = Date.UTC(2026, 7, 8);
const SESSION_DAYS = [0, 13, 24, 29, 45, 54, 62, 71, 85, 90];
const ASKED_AT = '2026-11-06T20:00:00.000Z';
const DAY = 86400000;
const PAIRS = 10;
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const VOCABULARY = {
    prefixes: ['弥珞', '汀迦', '岑缇', '雾佑', '奚葭', '绒玥', '苔岚', '霁桉', '绛洵', '澄苓', '菱祈', '穗沐', '枝漪', '荻绫', '焰渚', '砾朔', '棠洄', '鸢徊', '蘅皎', '珀泠'],
    suffixes: ['羽笺', '绒灯', '瓷栈', '雀柜', '铜岛', '雾轮', '星梭', '纸炉', '松屿', '蜡匣', '河伞', '风印', '镜塔', '露船', '鲸杯', '苔盘'],
    noise: [
        ['我还在发呆。', '慢慢来。'],
        ['刚才那一页有点难翻。', '纸页粘一起了吗？'],
        ['哈，窗边那个影子突然动了。', '刚好有风吧。'],
        ['先让我想一下。', '嗯。'],
        ['等一下，我去把桌面腾一腾。', '好，你去吧。'],
        ['这句看起来像在绕口令。', '读第二遍就顺了。'],
        ['楼下刚刚响了一声。', '我陪你听听。'],
        ['手上这一页终于平了。', '可以继续了。'],
    ],
    acknowledgments: ['我听到了。', '嗯，继续说吧。', '原来如此。', '好，我明白了。', '这下清楚了。'],
};
const PREDICATES = {
    bookmark: ['书签', '夹页', '标记'],
    binding: ['装订', '封边'],
    tea: ['茶', '热饮', '喝'],
    meeting: ['碰头', '见面', '集合'],
    storage: ['放在', '收纳', '归档', '位置', '收在', '存放', '搁在'],
    firstStep: ['第一步', '起步', '先'],
    nextStep: ['下一步', '接下来', '进度', '走到'],
    tool: ['工具', '用', '器具'],
    route: ['入口', '从', '进场'],
    datedEvent: ['盖章', '封签', '点亮', '完工', '登记', '校验'],
    offset: ['夏令时', '标准时', '点亮', 'UTC', '时区'],
    plan: ['计划', '打算', '预计'],
    slot: ['陈列', '位置', '展台', '摆'],
    code: ['暗记', '口令', '代号'],
    date: ['日期', '某天', '哪天', '时候'],
};

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Mulberry32 with integer arithmetic and a fixed case-ID salt.
function randomFor(seed, label) {
    let state = seed >>> 0;
    for (const char of label) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), state | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (options, random) => options[Math.floor(random() * options.length)];

function timestamp(session, pair, assistant = false) {
    const hours = session === 5 ? 1 : 13;
    return new Date(BASE + SESSION_DAYS[session] * DAY + hours * 3600000 + (pair * 2 + Number(assistant)) * 60000).toISOString();
}

function localDate(timestamp) {
    const parts = Object.fromEntries(LOCAL_DATE.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateTerms(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    return [isoDate, `${year}年${month}月${day}日`, `${year}年${month}月${day}号`, `${year}/${month}/${day}`, `${year}.${month}.${day}`];
}

function contextTurns(testCase, pairs) {
    return pairs.flatMap((pair, index) => pair.map((content, role) => ({
        id: `${testCase.id}-context-${index * 2 + role + 1}`,
        role: role ? 'assistant' : 'user',
        content,
        timestamp: new Date(Date.parse(ASKED_AT) - (pairs.length - index) * 120000 + role * 60000).toISOString(),
    })));
}

function allocateSource(instance, preferredSession, assistant, sourceContext) {
    for (let offset = 0; offset < SESSION_DAYS.length; offset++) {
        const session = (preferredSession + offset) % SESSION_DAYS.length;
        const lines = instance.lines[session];
        const pair = lines.findIndex((line, index) => line === null
            && (!sourceContext || (index > 0 && lines[index - 1] === null)));
        if (pair === -1) continue;
        lines[pair] = {};
        if (sourceContext) lines[pair - 1] = {};
        const idPrefix = `${instance.id}-s${session + 1}-m`;
        return {
            id: idPrefix + (pair * 2 + Number(assistant) + 1),
            timestamp: timestamp(session, pair, assistant),
            ...(sourceContext ? { contextIds: [idPrefix + (pair * 2 - 1), idPrefix + pair * 2] } : {}),
            render(content) {
                lines[pair] = { assistant, content };
                if (sourceContext) {
                    const [content, assistantReply] = sourceContext;
                    lines[pair - 1] = { content, assistantReply };
                }
            },
        };
    }
    throw new Error('CM3_HISTORY_FULL');
}

function makeInstance(id, ownerId, mode) {
    return { id, ownerId, mode, roleKey: 'synthetic-character', sourceTimezone: ZONE,
        lines: SESSION_DAYS.map(() => Array(PAIRS).fill(null)) };
}

export function generateChatMemoryDataset({ seed = CORE_SEED } = {}) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('CM3_INVALID_SEED');
    const owners = [{ id: 'owner-1' }, { id: 'owner-2' }];
    const scopes = [
        makeInstance('instance-1', owners[0].id, 'COMPANION'),
        makeInstance('instance-2', owners[0].id, 'COMPANION'),
        makeInstance('instance-3', owners[1].id, 'COMPANION'),
        makeInstance('instance-4', owners[1].id, 'STORY'),
    ];
    const facts = [], cases = [], renderLines = [];
    const words = VOCABULARY.prefixes.flatMap(prefix => VOCABULARY.suffixes.map(suffix => prefix + suffix));
    function namesFor(caseId) {
        const random = randomFor(seed, caseId);
        return () => {
            if (!words.length) throw new Error('CM3_VOCABULARY_EXHAUSTED');
            return words.splice(Math.floor(random() * words.length), 1)[0];
        };
    }
    function addFact(instance, options) {
        const { subject, predicate, session, kind = 'durable', supersedes = null } = options;
        const previous = facts.find(fact => fact.factId === supersedes);
        const source = kind === 'manual' ? null : allocateSource(instance, session, kind === 'assistant', options.sourceContext);
        const value = options.value ?? localDate(source.timestamp);
        const fact = {
            factId: `fact-${String(facts.length + 1).padStart(3, '0')}`,
            scope: { ownerId: instance.ownerId, instanceId: instance.id, mode: instance.mode },
            subject, predicate, value, valueAliases: options.valueAliases ?? (options.value === undefined ? dateTerms(value).slice(1) : []),
            sourceTurnIds: source ? [source.id] : [...previous.sourceTurnIds],
            ...(source?.contextIds ? { contextSourceTurnIds: source.contextIds } : {}),
            validFrom: source?.timestamp ?? ASKED_AT, validTo: null, supersedes, forgottenAt: null, kind,
        };
        if (previous) previous.validTo = fact.validFrom;
        facts.push(fact);
        if (source) renderLines.push(() => source.render(options.line(fact)));
        return fact;
    }

    function addCase(instance, category, index, query, gold = [], options = {}) {
        const forbidden = options.forbidden ?? [];
        const testCase = {
            id: `${category}-${String(index + 1).padStart(2, '0')}`,
            category, ownerId: instance.ownerId, instanceId: instance.id, askedAt: ASKED_AT,
            query, recentMessages: [], goldFactIds: gold.map(fact => fact.factId),
            evidenceSets: gold.length ? [gold.map(fact => fact.factId)] : [],
            expectedAnswer: options.expectedAnswer ?? (gold.length ? gold.map(fact => fact.value).join('、') : '简短说明没有足够信息，或向用户澄清'),
            requiredTerms: options.requiredTerms ?? gold.map(fact => [fact.value, ...fact.valueAliases]),
            forbiddenFactIds: forbidden.map(fact => fact.factId),
            forbiddenTerms: options.forbiddenTerms ?? forbidden.flatMap(fact => [fact.value, ...fact.valueAliases]),
            tags: options.tags ?? [],
            ...(options.action ? { action: options.action } : {}),
        };
        testCase.recentMessages = contextTurns(testCase, options.context ?? []);
        cases.push(testCase);
        return testCase;
    }

    // Reserve exact source sessions before allocating the less time-sensitive turns.
    for (let i = 0; i < 20; i++) {
        const name = namesFor(`time-${i + 1}`), instance = scopes[i % 3], subject = name();
        switch (i % 5) {
        case 0: {
            const historical = i >= 10;
            const historicDate = '2025-12-31';
            const fact = addFact(instance, { subject, predicate: 'datedEvent', session: historical ? 8 : 5,
                ...(historical ? { value: historicDate, valueAliases: dateTerms(historicDate).slice(1) } : {}),
                line: () => historical
                    ? `我在旧册上核对过：给${subject}盖最后一枚章时，UTC已是2026年1月1日，但纽约当地是2025年12月31日晚。`
                    : `就在刚刚，我给${subject}盖好最后一枚章了。` });
            addCase(instance, 'time', i, `${subject}最后盖章按纽约当地日历是几几年几月几日？`, [fact],
                { tags: historical ? ['year-boundary', 'historical-date'] : ['local-midnight', 'month-boundary'] });
            break;
        }
        case 1: {
            const first = addFact(instance, { subject, predicate: 'datedEvent', session: 1,
                line: () => `今天我第一次给${subject}做了封签。` });
            const second = addFact(instance, { subject, predicate: 'datedEvent', session: 3,
                line: () => `${subject}的第二次封签也在今天做完了。` });
            const days = (Date.parse(second.value) - Date.parse(first.value)) / DAY;
            addCase(instance, 'time', i, `${subject}两次封签之间相隔几个自然日？`, [first, second],
                { expectedAnswer: `${days}天`, requiredTerms: [[`${days}天`, '十六天', '十六日', `${days}日`]], tags: ['calendar-interval', 'month-boundary'] });
            break;
        }
        case 2: {
            const daylight = addFact(instance, { subject, predicate: 'offset', session: 8, value: 'UTC-04:00',
                valueAliases: ['UTC−04:00', '夏令时凌晨一点半', '夏令时01:30'],
                line: () => `纽约今天回拨。我第一次点亮${subject}时，是夏令时凌晨一点半（UTC-04:00）。` });
            const standard = addFact(instance, { subject, predicate: 'offset', session: 8, value: 'UTC-05:00',
                valueAliases: ['UTC−05:00', '标准时凌晨一点半', '标准时01:30'],
                line: () => `同一天，我第二次点亮${subject}是在标准时凌晨一点半（UTC-05:00）。` });
            addCase(instance, 'time', i, `纽约回拨那天，${subject}两次点亮实际隔了多久？`, [daylight, standard],
                { expectedAnswer: '一小时', requiredTerms: [['一小时', '一个小时', '1小时', '1个小时', '60分钟', '六十分钟']], tags: ['dst-fold'] });
            break;
        }
        case 3: {
            const plan = addFact(instance, { subject, predicate: 'plan', session: 4, kind: 'planned', value: '2026-10-28',
                valueAliases: dateTerms('2026-10-28').slice(1), line: () => `我原来计划2026年10月28日完成${subject}的最后一次校验。` });
            const done = addFact(instance, { subject, predicate: 'datedEvent', session: 9,
                line: () => `后来推迟了，今天我才真正做完${subject}的最后一次校验。` });
            addCase(instance, 'time', i, `${subject}最后一次校验实际完成的年月日是什么？只说实际日期。`, [done],
                { forbiddenTerms: [plan.value, ...plan.valueAliases], tags: ['plan-vs-done'] });
            break;
        }
        case 4:
            addFact(instance, { subject, predicate: 'date', session: 6, kind: 'unresolved', value: '九月某个下雨天',
                line: () => `${subject}的登记是九月某个下雨天办的，具体几号我也记不准。` });
            addCase(instance, 'time', i, `${subject}到底是哪一天办登记的？`, [],
                { expectedAnswer: '只知道是九月某个下雨天，无法确定日期', tags: ['date-clarification'] });
            break;
        }
    }

    const singles = [
        ['bookmark', (s, v) => `我一直用${v}给${s}夹页。`, s => `我给${s}用的书签是什么？`, s => `${s}翻到一半时，我拿什么做页间标记来着？`],
        ['binding', (s, v) => `${s}以后都按${v}式装订，封边沿用这个方案。`, s => `${s}选的装订样式是什么？`, s => `${s}以后做封边得照哪套方案？`],
        ['tea', (s, v) => `我在${s}最爱喝的是${v}茶，去那儿就点这个。`, s => `我在${s}最喜欢喝哪种茶？`, s => `去${s}时，哪杯热饮是我的老样子？`],
        ['meeting', (s, v) => `我们说定了：以后整理${s}前，先在${v}碰头。`, s => `整理${s}前约在哪儿碰头？`, s => `下回开工弄${s}，我先去哪儿找你？`],
        ['storage', (s, v) => `今天桌上没地儿，暂时把${s}搁在${v}，等会儿就挪走。`, s => `我平时把${s}放在哪儿？`, s => `${s}平常收在哪个地方？`],
    ];
    const windowConfirmations = [
        ['这本我还是拿老样子的东西夹页，翻起来方便。', (s, v) => `你是说以后给${s}夹页，都用${v}当书签？`,
            '对，就是那个。以后我都用它。'],
        ['封边就照先前说的那种做吧。', (s, v) => `确认一下，${s}以后都按${v}式装订？`,
            '嗯，定了。以后都按那个做。'],
        ['到了我还是点那个，喝惯了。', (s, v) => `你在${s}最喜欢喝的是${v}茶，对吗？`,
            '对呀，就是那一杯，我最爱喝。'],
        ['还是老地方见吧，别一人跑一边。', (s, v) => `是说以后每次整理${s}前，都先到${v}碰头？`,
            '没错，就在那里，以后都这么约。'],
    ];
    for (let i = 0; i < 20; i++) {
        const name = namesFor(`single-${i + 1}`), instance = scopes[i % 3], subject = name(), value = name();
        const [predicate, render, direct, paraphrase] = singles[i % singles.length];
        const transient = predicate === 'storage';
        const confirmation = windowConfirmations[i];
        const fact = addFact(instance, { subject, predicate, value, session: i % 3 * 3, kind: transient ? 'transient' : 'durable',
            valueAliases: predicate === 'tea' ? [`${value}茶`] : [],
            ...(confirmation ? { sourceContext: [confirmation[0], confirmation[1](subject, value)] } : {}),
            line: () => confirmation ? confirmation[2] : render(subject, value) });
        const style = i % 2 ? 'paraphrase' : 'direct';
        const tags = [style, transient ? 'transient-control' : 'durable'];
        if (confirmation) tags.push('extraction-window');
        if (!transient && i < 6) tags.push('long-session');
        addCase(instance, 'single', i, (style === 'direct' ? direct : paraphrase)(subject), transient ? [] : [fact],
            { tags, forbidden: transient ? [fact] : [] });
    }

    const m09 = scopes[0], m09Name = namesFor('cross_session-M09');
    const topic = `${m09Name()}阅读计划`, otherTopic = `${m09Name()}装订计划`;
    const first = addFact(m09, { subject: topic, predicate: 'firstStep', value: m09Name(), session: 0,
        line: fact => `${topic}第一步是读完${fact.value}这一册。我刚读完了。` });
    const next = addFact(m09, { subject: topic, predicate: 'nextStep', value: m09Name(), session: 6,
        line: fact => `${topic}进度更新：接下来读${fact.value}这一册，这册还没开始。` });
    addFact(m09, { subject: otherTopic, predicate: 'nextStep', value: m09Name(), session: 7,
        line: fact => `${otherTopic}走到${fact.value}试装，等试完再订正式版。` });
    const soleTopic = [[`今天想继续${topic}。`, '好，接着聊。'], ['先回顾一下吧。', '嗯。']];
    const mixedTopics = [[`我想继续${topic}。`, '行。'], [`${otherTopic}也搁了很久。`, '嗯，这两件都可以接着聊。']];
    const progressQuery = `${topic}上次走到哪一步了？已经完成和接下来各是什么？`;
    const progressAnswer = `读完了${first.value}，接下来读${next.value}。`;
    addCase(m09, 'cross_session', 0, '我们上次谈到哪一步了？', [first, next],
        { expectedAnswer: progressAnswer, context: soleTopic, tags: ['M09-direct', 'M09-single-topic', 'long-session'] });
    addCase(m09, 'cross_session', 1, progressQuery, [first, next],
        { expectedAnswer: progressAnswer, context: soleTopic, tags: ['M09-rewrite', 'M09-single-topic', 'long-session'] });
    addCase(m09, 'cross_session', 2, '我们上次谈到哪一步了？', [],
        { expectedAnswer: '请用户澄清指的是阅读计划还是装订计划', context: mixedTopics, tags: ['M09-direct', 'M09-multi-topic'] });
    addCase(m09, 'cross_session', 3, progressQuery, [first, next],
        { expectedAnswer: progressAnswer, context: mixedTopics, tags: ['M09-rewrite', 'M09-multi-topic', 'long-session'] });

    for (let i = 4; i < 20; i++) {
        const name = namesFor(`cross_session-${i + 1}`), instance = scopes[i % 3], subject = name();
        const early = i % 3 * 2, late = early + 5;
        const tool = addFact(instance, { subject, predicate: 'tool', value: name(), session: early,
            line: fact => `修${subject}只用${fact.value}这件工具，别拿旁边那套。` });
        const gate = addFact(instance, { subject, predicate: 'route', value: name(), session: late,
            line: fact => `入口牌改好了。以后去修${subject}都从${fact.value}入口进。` });
        const query = i % 2 ? `去修${subject}，我该带什么，从哪里进去？` : `${subject}那趟维修的器具和进场入口分别是什么？`;
        addCase(instance, 'cross_session', i, query, [tool, gate], { tags: [`source-sessions-${early + 1}-${late + 1}`] });
    }

    for (let i = 0; i < 20; i++) {
        const name = namesFor(`update-${i + 1}`), instance = scopes[i % 3], subject = name(), manual = i % 2 === 1, historical = i % 5 === 4;
        const old = addFact(instance, { subject, predicate: 'slot', value: name(), session: 2,
            line: fact => `${subject}第一次布展时摆在${fact.value}，当时的位置就定在那里。` });
        const value = name(), replacementContent = `${subject}现在的陈列位置是${value}。`;
        const current = addFact(instance, { subject, predicate: 'slot', value, session: 8, supersedes: old.factId,
            kind: manual ? 'manual' : 'durable',
            line: () => `我改主意了，${subject}以后摆在${value}，之前那个位置不用了。` });
        addCase(instance, 'update', i, historical
            ? `${subject}第一次布展时摆在哪儿？只说当时。`
            : `${subject}现在该摆在哪儿？只说当前的位置。`,
        [historical ? old : current], {
            forbiddenTerms: [historical ? current.value : old.value],
            tags: [manual ? 'manual-correction' : 'natural-update', historical ? 'historical' : 'current'],
            action: manual ? { kind: 'correct', targetFactId: old.factId, replacementFactId: current.factId, replacementContent } : undefined,
        });
    }

    for (let i = 0; i < 20; i++) {
        const name = namesFor(`forget-${i + 1}`), instance = scopes[i % 3], subject = name();
        const fact = addFact(instance, { subject, predicate: 'code', value: name(), session: 4 + i % 4,
            line: fact => `${subject}对我来说很特别，我给它设的暗记是${fact.value}。` });
        fact.forgottenAt = ASKED_AT;
        fact.validTo = ASKED_AT;
        addCase(instance, 'forget', i, i % 2 ? `我给${subject}留的代号是哪个？` : `${subject}的暗记是什么？`, [],
            { forbidden: [fact], tags: ['memory-only'], action: { kind: 'forget', targetFactId: fact.factId, stages: [...FORGET_STAGES] } });
    }

    const isolationFacts = Array.from({ length: 5 }, (_, index) => {
        const name = namesFor(`isolation-${index + 1}`), subject = name();
        return scopes.map(instance => addFact(instance, { subject, predicate: 'storage', value: name(), session: index * 2,
            line: fact => `我把${subject}长期收在${fact.value}，找它就去那里。` }));
    });
    isolationFacts.forEach((group, index) => group.forEach((fact, scopeIndex) => {
        const instance = scopes[scopeIndex], story = instance.mode === 'STORY';
        const forbidden = group.filter(other => story || other !== fact);
        addCase(instance, 'isolation', index * scopes.length + scopeIndex,
            index % 2 ? `${fact.subject}归档归到哪里了？` : `我把${fact.subject}收在哪儿？`,
            story ? [] : [fact], { forbidden, tags: story ? ['cross-mode', 'story-no-memory'] : ['same-role', 'cross-owner', 'cross-instance', 'cross-mode'] });
    }));

    for (let i = 0; i < 20; i++) {
        const name = namesFor(`abstain-${i + 1}`), instance = scopes[i % 3], subject = name();
        switch (i % 5) {
        case 0:
            addCase(instance, 'abstain', i, `我有说过${subject}的名字取自哪里吗？`, [], { tags: ['never-disclosed'] });
            break;
        case 1: {
            const fact = addFact(instance, { subject, predicate: 'tea', value: name(), session: 4, kind: 'assistant',
                line: fact => `我自己去${subject}时喜欢喝${fact.value}茶。你呢？` });
            addCase(instance, 'abstain', i, `我去${subject}时最喜欢喝什么？`, [], { forbidden: [fact], tags: ['assistant-only'] });
            break;
        }
        case 2:
            addFact(instance, { subject, predicate: 'date', value: '上个月某天', session: 7, kind: 'unresolved',
                line: () => `${subject}是在上个月某天送去登记的，日期已经记不清了。` });
            addCase(instance, 'abstain', i, `你记得我把${subject}送去登记的具体日期吗？`, [], { tags: ['fuzzy-date'] });
            break;
        case 3: {
            const one = name(), two = name();
            addFact(instance, { subject, predicate: 'route', value: one, session: 4, kind: 'unresolved',
                line: () => `我手上的一张${subject}进场票写的是${one}入口。` });
            addFact(instance, { subject, predicate: 'route', value: two, session: 5, kind: 'unresolved',
                line: () => `另一张${subject}进场票却写了${two}入口。我还没确认该按哪张走。` });
            addCase(instance, 'abstain', i, `进${subject}确定该走哪个入口？`, [],
                { expectedAnswer: '两张票不一致，请确认有效的票或入口', tags: ['unresolved-conflict'] });
            break;
        }
        case 4: {
            const remote = scopes[(i + 1) % 3];
            const fact = addFact(remote, { subject, predicate: 'code', value: name(), session: 7,
                line: fact => `${subject}的口令我只在这里记一下：${fact.value}。` });
            addCase(instance, 'abstain', i, `${subject}的口令我跟你讲过吗？`, [], { forbidden: [fact], tags: ['inaccessible'] });
            break;
        }
        }
    }

    for (const render of renderLines) render();
    const instances = scopes.map(({ lines, ...instance }) => ({
        ...instance,
        sessions: lines.map((pairs, session) => ({
            id: `${instance.id}-s${session + 1}`,
            messages: pairs.flatMap((line, pair) => {
                const random = randomFor(seed, `${instance.id}-${session}-${pair}`);
                const [user, assistant] = line?.assistant
                    ? ['随便聊聊，你自己有什么偏好？', line.content]
                    : line ? [line.content, line.assistantReply ?? pick(VOCABULARY.acknowledgments, random)] : pick(VOCABULARY.noise, random);
                return [user, assistant].map((content, role) => ({
                    id: `${instance.id}-s${session + 1}-m${pair * 2 + role + 1}`,
                    role: role ? 'assistant' : 'user',
                    content,
                    timestamp: timestamp(session, pair, Boolean(role)),
                }));
            }),
        })),
    }));
    for (const testCase of cases) {
        if (!testCase.tags.includes('long-session')) continue;
        const messages = instances.find(instance => instance.id === testCase.instanceId).sessions.flatMap(session => session.messages);
        testCase.truncationControl = { totalMessages: messages.length, windowMessages: 32, recentMessages: messages.slice(-32) };
    }
    cases.sort((a, b) => CASE_CATEGORIES.indexOf(a.category) - CASE_CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id, 'en'));
    const hashes = { templates: digest([VERSION, VOCABULARY, PREDICATES, generateChatMemoryDataset.toString()]),
        facts: digest(facts), dialogue: digest(instances), cases: digest(cases) };
    const sourceCounts = { messages: 0, userTurns: 0, eligibleUserTurns: 0, ineligibleStoryUserTurns: 0 };
    for (const instance of instances) {
        for (const { messages } of instance.sessions) {
            const userTurns = messages.filter(message => message.role === 'user').length;
            sourceCounts.messages += messages.length;
            sourceCounts.userTurns += userTurns;
            sourceCounts[instance.mode === 'COMPANION' ? 'eligibleUserTurns' : 'ineligibleStoryUserTurns'] += userTurns;
        }
    }
    return { version: VERSION, seed, hashes: { ...hashes, dataset: digest([VERSION, seed, hashes]) }, sourceCounts, owners, instances, facts, cases };
}

export function forgetStageCase(dataset, testCase, stage) {
    if (testCase.action?.kind !== 'forget' || !FORGET_STAGES.includes(stage)) throw new Error('CM3_INVALID_FORGET_STAGE');
    if (stage !== 'before') return testCase;
    const target = dataset.facts.find(fact => fact.factId === testCase.action.targetFactId);
    return { ...testCase, askedAt: new Date(Date.parse(target.forgottenAt) - 1000).toISOString(), goldFactIds: [target.factId], evidenceSets: [[target.factId]], expectedAnswer: target.value,
        requiredTerms: [[target.value, ...target.valueAliases]], forbiddenFactIds: [], forbiddenTerms: [] };
}

export function factMatchTerms(fact) {
    const subjectTerms = [fact.subject, fact.subject.split(/阅读计划|装订计划/)[0]];
    return { identity: [...new Set([...subjectTerms, ...PREDICATES[fact.predicate]])], values: [fact.value, ...fact.valueAliases] };
}
